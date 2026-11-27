use axum::{extract::{Path, Query, State}, http::{HeaderMap, StatusCode}, response::{IntoResponse, Response}, routing::get, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

const Q_LIST: &str = "SELECT id, station_id, pump_id, qty_ml, price_e4, amount, created_at FROM sales WHERE station_id=$1 ORDER BY id DESC LIMIT $2";
const Q_DAY: &str = "SELECT COALESCE(SUM(amount),0)::BIGINT, COALESCE(SUM(qty_ml),0)::BIGINT FROM sales WHERE station_id=$1 AND created_at>=$2 AND created_at<$3";
const Q_TB: &str = "SELECT COALESCE(SUM(l.debit),0)::BIGINT, COALESCE(SUM(l.credit),0)::BIGINT FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.station_id=$1";
const Q_ORG: &str = "SELECT org_id FROM stations WHERE id=$1";
const I_SALE: &str = "INSERT INTO sales(station_id,pump_id,qty_ml,price_e4,amount,created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id";
const I_MOVE: &str = "INSERT INTO stock_moves(station_id,tank_id,qty_ml,ref_sale) VALUES ($1,$2,$3,$4)";
const I_JR: &str = "INSERT INTO journals(station_id,source,ref) VALUES ($1,'sale',$2) RETURNING id";
const I_JL: &str = "INSERT INTO journal_lines(journal_id,account_id,debit,credit) VALUES ($1,1100,$2,0),($1,4100,0,$2),($1,5100,$3,0),($1,1300,0,$3)";
const I_AU: &str = "INSERT INTO audit(org_id,action,ref) VALUES ($1,'sale.create',$2)";

#[derive(Serialize)]
struct Sale { id: i64, station_id: i64, pump_id: i64, qty_ml: i64, price_e4: i64, amount: i64, created_at: i64 }
#[derive(Deserialize)]
struct In { pump_id: i64, qty_ml: i64, price_e4: i64 }
#[derive(Deserialize)]
struct LimitQ { limit: Option<i64> }
#[derive(Deserialize)]
struct DayQ { day: Option<String> }

struct E(StatusCode, String);
impl IntoResponse for E { fn into_response(self) -> Response { (self.0, Json(json!({"error": self.1}))).into_response() } }
fn ise<T: std::fmt::Display>(e: T) -> E { E(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()) }
fn nf() -> E { E(StatusCode::NOT_FOUND, "not found".into()) }
type R<T> = Result<T, E>;

enum Db { Lite { rd: r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>, wr: Arc<Mutex<rusqlite::Connection>> }, Pg(deadpool_postgres::Pool) }
type St = Arc<Db>;

fn org_of(h: &HeaderMap) -> R<i64> {
    h.get("x-org").and_then(|v| v.to_str().ok()).and_then(|s| s.parse::<i64>().ok()).filter(|v| *v > 0).ok_or(E(StatusCode::UNAUTHORIZED, "X-Org".into()))
}
fn day_range(d: &Option<String>) -> R<(String, i64)> {
    let d = d.clone().unwrap_or_default();
    let t = chrono::NaiveDate::parse_from_str(&d, "%Y-%m-%d").map_err(|_| E(StatusCode::BAD_REQUEST, "bad day".into()))?;
    Ok((d, t.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp()))
}
fn lite_check(c: &rusqlite::Connection, org: i64, sid: i64) -> R<()> {
    let o: Option<i64> = c.prepare_cached(Q_ORG).map_err(ise)?.query_row([sid], |r| r.get(0)).ok();
    if o == Some(org) { Ok(()) } else { Err(nf()) }
}
async fn pg_check(c: &deadpool_postgres::ClientWrapper, org: i64, sid: i64) -> R<()> {
    let st = c.prepare_cached(Q_ORG).await.map_err(ise)?;
    let r = c.query_opt(&st, &[&sid]).await.map_err(ise)?;
    if r.map(|r| r.get::<_, i64>(0)) == Some(org) { Ok(()) } else { Err(nf()) }
}

async fn list(State(db): State<St>, Path(sid): Path<i64>, Query(q): Query<LimitQ>, h: HeaderMap) -> R<Json<Vec<Sale>>> {
    let org = org_of(&h)?; let lim = q.limit.filter(|l| *l > 0 && *l <= 200).unwrap_or(50);
    match &*db {
        Db::Lite { rd, .. } => {
            let rd = rd.clone();
            tokio::task::spawn_blocking(move || -> R<Vec<Sale>> {
                let c = rd.get().map_err(ise)?; lite_check(&c, org, sid)?;
                let mut st = c.prepare_cached(Q_LIST).map_err(ise)?;
                let rows = st.query_map([sid, lim], |r| Ok(Sale { id: r.get(0)?, station_id: r.get(1)?, pump_id: r.get(2)?, qty_ml: r.get(3)?, price_e4: r.get(4)?, amount: r.get(5)?, created_at: r.get(6)? })).map_err(ise)?;
                rows.collect::<Result<Vec<_>, _>>().map_err(ise)
            }).await.map_err(ise)?.map(Json)
        }
        Db::Pg(p) => {
            let c = p.get().await.map_err(ise)?; pg_check(&c, org, sid).await?;
            let st = c.prepare_cached(Q_LIST).await.map_err(ise)?;
            let rows = c.query(&st, &[&sid, &lim]).await.map_err(ise)?;
            Ok(Json(rows.iter().map(|r| Sale { id: r.get(0), station_id: r.get(1), pump_id: r.get::<_, i32>(2) as i64, qty_ml: r.get::<_, i32>(3) as i64, price_e4: r.get::<_, i32>(4) as i64, amount: r.get(5), created_at: r.get(6) }).collect()))
        }
    }
}

async fn summary(State(db): State<St>, Path(sid): Path<i64>, Query(q): Query<DayQ>, h: HeaderMap) -> R<Json<Value>> {
    let org = org_of(&h)?; let (day, a) = day_range(&q.day)?;
    let (amt, qty, dr, cr): (i64, i64, i64, i64) = match &*db {
        Db::Lite { rd, .. } => {
            let rd = rd.clone();
            tokio::task::spawn_blocking(move || -> R<(i64, i64, i64, i64)> {
                let c = rd.get().map_err(ise)?; lite_check(&c, org, sid)?;
                let (x, y) = c.prepare_cached(&Q_DAY.replace("::BIGINT","")).map_err(ise)?.query_row([sid, a, a + 86400], |r| Ok((r.get(0)?, r.get(1)?))).map_err(ise)?;
                let (u, v) = c.prepare_cached(&Q_TB.replace("::BIGINT","")).map_err(ise)?.query_row([sid], |r| Ok((r.get(0)?, r.get(1)?))).map_err(ise)?;
                Ok((x, y, u, v))
            }).await.map_err(ise)??
        }
        Db::Pg(p) => {
            let c = p.get().await.map_err(ise)?; pg_check(&c, org, sid).await?;
            let s1 = c.prepare_cached(Q_DAY).await.map_err(ise)?; let s2 = c.prepare_cached(Q_TB).await.map_err(ise)?;
            let b = a + 86400;
            let r1 = c.query_one(&s1, &[&sid, &a, &b]).await.map_err(ise)?; let r2 = c.query_one(&s2, &[&sid]).await.map_err(ise)?;
            (r1.get(0), r1.get(1), r2.get(0), r2.get(1))
        }
    };
    Ok(Json(json!({"day": day, "sales_amount": amt, "sales_qty_ml": qty, "tb_debit": dr, "tb_credit": cr})))
}

async fn create(State(db): State<St>, Path(sid): Path<i64>, h: HeaderMap, body: axum::body::Bytes) -> R<(StatusCode, Json<Value>)> {
    let org = org_of(&h)?;
    let i: In = serde_json::from_slice(&body).map_err(|_| E(StatusCode::BAD_REQUEST, "json".into()))?;
    if i.pump_id <= 0 || i.qty_ml <= 0 || i.price_e4 <= 0 { return Err(E(StatusCode::BAD_REQUEST, "bad body".into())); }
    let amount = i.qty_ml * i.price_e4 / 10000; let cost = amount * 9 / 10;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    let (id, j): (i64, i64) = match &*db {
        Db::Lite { wr, .. } => {
            let wr = wr.clone();
            tokio::task::spawn_blocking(move || -> R<(i64, i64)> {
                let mut c = wr.lock().unwrap();
                let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(ise)?;
                lite_check(&tx, org, sid)?;
                let id: i64 = tx.prepare_cached(I_SALE).map_err(ise)?.query_row(rusqlite::params![sid, i.pump_id, i.qty_ml, i.price_e4, amount, now], |r| r.get(0)).map_err(ise)?;
                tx.prepare_cached(I_MOVE).map_err(ise)?.execute(rusqlite::params![sid, i.pump_id % 2 + 1, -i.qty_ml, id]).map_err(ise)?;
                let j: i64 = tx.prepare_cached(I_JR).map_err(ise)?.query_row([sid, id], |r| r.get(0)).map_err(ise)?;
                tx.prepare_cached(I_JL).map_err(ise)?.execute([j, amount, cost]).map_err(ise)?;
                tx.prepare_cached(I_AU).map_err(ise)?.execute([org, id]).map_err(ise)?;
                tx.commit().map_err(ise)?; Ok((id, j))
            }).await.map_err(ise)??
        }
        Db::Pg(p) => {
            let mut c = p.get().await.map_err(ise)?;
            let tx = c.transaction().await.map_err(ise)?;
            let st = tx.prepare_cached(Q_ORG).await.map_err(ise)?;
            if tx.query_opt(&st, &[&sid]).await.map_err(ise)?.map(|r| r.get::<_, i64>(0)) != Some(org) { return Err(nf()); }
            let (pump, qty, price, tank, neg) = (i.pump_id as i32, i.qty_ml as i32, i.price_e4 as i32, (i.pump_id % 2 + 1) as i32, -(i.qty_ml as i32));
            let s = tx.prepare_cached(I_SALE).await.map_err(ise)?; let id: i64 = tx.query_one(&s, &[&sid, &pump, &qty, &price, &amount, &now]).await.map_err(ise)?.get(0);
            let s = tx.prepare_cached(I_MOVE).await.map_err(ise)?; tx.execute(&s, &[&sid, &tank, &neg, &id]).await.map_err(ise)?;
            let s = tx.prepare_cached(I_JR).await.map_err(ise)?; let j: i64 = tx.query_one(&s, &[&sid, &id]).await.map_err(ise)?.get(0);
            let s = tx.prepare_cached(I_JL).await.map_err(ise)?; tx.execute(&s, &[&j, &amount, &cost]).await.map_err(ise)?;
            let s = tx.prepare_cached(I_AU).await.map_err(ise)?; tx.execute(&s, &[&org, &id]).await.map_err(ise)?;
            tx.commit().await.map_err(ise)?; (id, j)
        }
    };
    Ok((StatusCode::CREATED, Json(json!({"id": id, "journal_id": j, "amount": amount}))))
}

#[tokio::main]
async fn main() {
    let dsn = std::env::var("DB").unwrap();
    let ncpu = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    let db = if dsn.starts_with("postgres") {
        let cfg: tokio_postgres::Config = dsn.parse().unwrap();
        let mgr = deadpool_postgres::Manager::new(cfg, tokio_postgres::NoTls);
        let n = std::env::var("PG_POOL").ok().and_then(|v| v.parse().ok()).unwrap_or(ncpu);
        Db::Pg(deadpool_postgres::Pool::builder(mgr).max_size(n).build().unwrap())
    } else {
        let f = dsn.trim_start_matches("sqlite:").to_string();
        // SQLITE_MMAP: mmap_size in bytes (default 0 = off; 256 MiB mmap made concurrent readers ~10x slower here)
        let mmap: i64 = std::env::var("SQLITE_MMAP").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
        let init = move |c: &mut rusqlite::Connection| c.execute_batch(&format!("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA cache_size=-65536; PRAGMA temp_store=MEMORY; PRAGMA mmap_size={mmap}; PRAGMA foreign_keys=ON;"));
        let mgr = r2d2_sqlite::SqliteConnectionManager::file(&f).with_init(init);
        let rd = r2d2::Pool::builder().max_size((ncpu * 2) as u32).build(mgr).unwrap();
        let mut w = rusqlite::Connection::open(&f).unwrap(); init(&mut w).unwrap();
        Db::Lite { rd, wr: Arc::new(Mutex::new(w)) }
    };
    let app = Router::new()
        .route("/stations/{sid}/sales", get(list).post(create))
        .route("/stations/{sid}/summary", get(summary))
        .with_state(Arc::new(db));
    let port = std::env::var("PORT").unwrap_or("8080".into());
    let l = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await.unwrap();
    axum::serve(l, app).await.unwrap();
}
