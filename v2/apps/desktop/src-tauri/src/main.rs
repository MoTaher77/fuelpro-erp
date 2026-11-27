// FuelPro desktop: one SQLite file (fuelpro.db) in the app data folder, one connection behind a mutex.
// The TypeScript core sends each statement through `db_exec`; transactions (BEGIN IMMEDIATE … COMMIT) therefore
// always run on the same connection. No network, no other commands.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use rusqlite::{types::Value as SqlValue, Connection};
use serde_json::{Map, Number, Value};
use std::sync::Mutex;
use tauri::Manager;

struct Db(Mutex<Connection>);

fn to_sql(v: &Value) -> Result<SqlValue, String> {
    Ok(match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => match n.as_i64() { Some(i) => SqlValue::Integer(i), None => SqlValue::Real(n.as_f64().ok_or("bad number")?) },
        Value::String(s) => SqlValue::Text(s.clone()),
        _ => return Err("unsupported parameter".into()),
    })
}
fn to_json(v: rusqlite::types::ValueRef) -> Value {
    use rusqlite::types::ValueRef::*;
    match v {
        Null => Value::Null,
        Integer(i) => Value::Number(i.into()),
        Real(f) => Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        Blob(_) => Value::Null,
    }
}

#[tauri::command]
fn db_exec(db: tauri::State<Db>, sql: String, params: Vec<Value>, reader: bool) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|_| "database lock poisoned")?;
    let args = params.iter().map(to_sql).collect::<Result<Vec<_>, _>>()?;
    let mut st = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
    let mut out = Map::new();
    if reader {
        let names: Vec<String> = st.column_names().iter().map(|s| s.to_string()).collect();
        let mut rows = st.query(rusqlite::params_from_iter(args.iter())).map_err(|e| e.to_string())?;
        let mut list = Vec::new();
        while let Some(r) = rows.next().map_err(|e| e.to_string())? {
            let mut o = Map::new();
            for (i, n) in names.iter().enumerate() { o.insert(n.clone(), to_json(r.get_ref(i).map_err(|e| e.to_string())?)); }
            list.push(Value::Object(o));
        }
        out.insert("rows".into(), Value::Array(list));
        out.insert("changes".into(), 0.into());
        out.insert("lastId".into(), 0.into());
    } else {
        let n = st.execute(rusqlite::params_from_iter(args.iter())).map_err(|e| e.to_string())?;
        out.insert("rows".into(), Value::Array(vec![]));
        out.insert("changes".into(), (n as i64).into());
        out.insert("lastId".into(), conn.last_insert_rowid().into());
    }
    Ok(Value::Object(out))
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = Connection::open(dir.join("fuelpro.db"))?;
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")?;
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![db_exec])
        .run(tauri::generate_context!())
        .expect("error while running FuelPro");
}
