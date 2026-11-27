package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/mattn/go-sqlite3"
)

type httpErr struct {
	code int
	msg  string
}

func (e httpErr) Error() string { return e.msg }

var errNF = httpErr{404, "not found"}

type Sale struct {
	ID        int64 `json:"id"`
	StationID int64 `json:"station_id"`
	PumpID    int64 `json:"pump_id"`
	QtyMl     int64 `json:"qty_ml"`
	PriceE4   int64 `json:"price_e4"`
	Amount    int64 `json:"amount"`
	CreatedAt int64 `json:"created_at"`
}
type In struct {
	PumpID  int64 `json:"pump_id"`
	QtyMl   int64 `json:"qty_ml"`
	PriceE4 int64 `json:"price_e4"`
}

const (
	qList = "SELECT id, station_id, pump_id, qty_ml, price_e4, amount, created_at FROM sales WHERE station_id=$1 ORDER BY id DESC LIMIT $2"
	qDay  = "SELECT COALESCE(SUM(amount),0), COALESCE(SUM(qty_ml),0) FROM sales WHERE station_id=$1 AND created_at>=$2 AND created_at<$3"
	qTB   = "SELECT COALESCE(SUM(l.debit),0), COALESCE(SUM(l.credit),0) FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.station_id=$1"
	qOrg  = "SELECT org_id FROM stations WHERE id=$1"
	iSale = "INSERT INTO sales(station_id,pump_id,qty_ml,price_e4,amount,created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id"
	iMove = "INSERT INTO stock_moves(station_id,tank_id,qty_ml,ref_sale) VALUES ($1,$2,$3,$4)"
	iJr   = "INSERT INTO journals(station_id,source,ref) VALUES ($1,'sale',$2) RETURNING id"
	iJl   = "INSERT INTO journal_lines(journal_id,account_id,debit,credit) VALUES ($1,1100,$2,0),($1,4100,0,$2),($1,5100,$3,0),($1,1300,0,$3)"
	iAu   = "INSERT INTO audit(org_id,action,ref) VALUES ($1,'sale.create',$2)"
)

// row/exec abstraction over database/sql (SQLite) and pgx (Postgres)
type q interface {
	QueryRow(ctx context.Context, s string, a ...any) interface{ Scan(...any) error }
	Exec(ctx context.Context, s string, a ...any) error
}
type sqlQ struct{ c interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	ExecContext(context.Context, string, ...any) (sql.Result, error)
} }

func (s sqlQ) QueryRow(ctx context.Context, q string, a ...any) interface{ Scan(...any) error } {
	return s.c.QueryRowContext(ctx, q, a...)
}
func (s sqlQ) Exec(ctx context.Context, q string, a ...any) error { _, e := s.c.ExecContext(ctx, q, a...); return e }

type pgQ struct{ c interface {
	QueryRow(context.Context, string, ...any) pgx.Row
} ; e func(context.Context, string, ...any) error }

func (p pgQ) QueryRow(ctx context.Context, q string, a ...any) interface{ Scan(...any) error } {
	return p.c.QueryRow(ctx, q, a...)
}
func (p pgQ) Exec(ctx context.Context, q string, a ...any) error { return p.e(ctx, q, a...) }

type Store struct {
	rd, wr *sql.DB
	pg     *pgxpool.Pool
}

func (s *Store) reader() q {
	if s.pg != nil {
		return pgQ{s.pg, func(c context.Context, q string, a ...any) error { _, e := s.pg.Exec(c, q, a...); return e }}
	}
	return sqlQ{s.rd}
}
func check(ctx context.Context, c q, org, sid int64) error {
	var o int64
	if err := c.QueryRow(ctx, qOrg, sid).Scan(&o); err != nil || o != org {
		return errNF
	}
	return nil
}
func (s *Store) list(ctx context.Context, org, sid, limit int64) ([]Sale, error) {
	if err := check(ctx, s.reader(), org, sid); err != nil {
		return nil, err
	}
	out := make([]Sale, 0, limit)
	scan := func(sc func(...any) error) error {
		var x Sale
		if e := sc(&x.ID, &x.StationID, &x.PumpID, &x.QtyMl, &x.PriceE4, &x.Amount, &x.CreatedAt); e != nil {
			return e
		}
		out = append(out, x)
		return nil
	}
	if s.pg != nil {
		rows, err := s.pg.Query(ctx, qList, sid, limit)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			if e := scan(rows.Scan); e != nil {
				return nil, e
			}
		}
		return out, rows.Err()
	}
	rows, err := s.rd.QueryContext(ctx, qList, sid, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		if e := scan(rows.Scan); e != nil {
			return nil, e
		}
	}
	return out, rows.Err()
}
func (s *Store) summary(ctx context.Context, org, sid int64, day string) (map[string]any, error) {
	c := s.reader()
	if err := check(ctx, c, org, sid); err != nil {
		return nil, err
	}
	t, err := time.Parse("2006-01-02", day)
	if err != nil {
		return nil, httpErr{400, "bad day"}
	}
	a := t.Unix()
	var amt, qty, dr, cr int64
	if err := c.QueryRow(ctx, qDay, sid, a, a+86400).Scan(&amt, &qty); err != nil {
		return nil, err
	}
	if err := c.QueryRow(ctx, qTB, sid).Scan(&dr, &cr); err != nil {
		return nil, err
	}
	return map[string]any{"day": day, "sales_amount": amt, "sales_qty_ml": qty, "tb_debit": dr, "tb_credit": cr}, nil
}
func (s *Store) create(ctx context.Context, org, sid int64, in In) (map[string]any, error) {
	if in.PumpID <= 0 || in.QtyMl <= 0 || in.PriceE4 <= 0 {
		return nil, httpErr{400, "bad body"}
	}
	amount := in.QtyMl * in.PriceE4 / 10000
	cost := amount * 9 / 10
	body := func(c q) (map[string]any, error) {
		if err := check(ctx, c, org, sid); err != nil {
			return nil, err
		}
		var id, j int64
		if err := c.QueryRow(ctx, iSale, sid, in.PumpID, in.QtyMl, in.PriceE4, amount, time.Now().Unix()).Scan(&id); err != nil {
			return nil, err
		}
		if err := c.Exec(ctx, iMove, sid, in.PumpID%2+1, -in.QtyMl, id); err != nil {
			return nil, err
		}
		if err := c.QueryRow(ctx, iJr, sid, id).Scan(&j); err != nil {
			return nil, err
		}
		if err := c.Exec(ctx, iJl, j, amount, cost); err != nil {
			return nil, err
		}
		if err := c.Exec(ctx, iAu, org, id); err != nil {
			return nil, err
		}
		return map[string]any{"id": id, "journal_id": j, "amount": amount}, nil
	}
	if s.pg != nil {
		tx, err := s.pg.Begin(ctx)
		if err != nil {
			return nil, err
		}
		defer tx.Rollback(ctx)
		r, err := body(pgQ{tx, func(c context.Context, q string, a ...any) error { _, e := tx.Exec(c, q, a...); return e }})
		if err != nil {
			return nil, err
		}
		return r, tx.Commit(ctx)
	}
	tx, err := s.wr.BeginTx(ctx, nil) // _txlock=immediate on the DSN
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	r, err := body(sqlQ{tx})
	if err != nil {
		return nil, err
	}
	return r, tx.Commit()
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, err error) {
	var he httpErr
	if errors.As(err, &he) {
		writeJSON(w, he.code, map[string]string{"error": he.msg})
		return
	}
	writeJSON(w, 500, map[string]string{"error": err.Error()})
}
func ids(r *http.Request) (int64, int64, error) {
	org, e1 := strconv.ParseInt(r.Header.Get("X-Org"), 10, 64)
	sid, e2 := strconv.ParseInt(r.PathValue("sid"), 10, 64)
	if e1 != nil || org <= 0 {
		return 0, 0, httpErr{401, "X-Org"}
	}
	if e2 != nil {
		return 0, 0, errNF
	}
	return org, sid, nil
}

func main() {
	dsn := os.Getenv("DB")
	s := &Store{}
	ctx := context.Background()
	if strings.HasPrefix(dsn, "postgres") {
		cfg, err := pgxpool.ParseConfig(dsn)
		if err != nil {
			panic(err)
		}
		n, _ := strconv.Atoi(os.Getenv("PG_POOL"))
		if n == 0 {
			n = runtime.NumCPU()
		}
		cfg.MaxConns = int32(n)
		if s.pg, err = pgxpool.NewWithConfig(ctx, cfg); err != nil {
			panic(err)
		}
	} else {
		f := strings.TrimPrefix(dsn, "sqlite:")
		p := "?_journal_mode=WAL&_synchronous=NORMAL&_busy_timeout=5000&_foreign_keys=1&_cache_size=-65536"
		var err error
		if s.rd, err = sql.Open("sqlite3", "file:"+f+p+"&mode=ro"); err != nil {
			panic(err)
		}
		s.rd.SetMaxOpenConns(runtime.NumCPU() * 2)
		s.rd.SetMaxIdleConns(runtime.NumCPU() * 2)
		if s.wr, err = sql.Open("sqlite3", "file:"+f+p+"&_txlock=immediate"); err != nil {
			panic(err)
		}
		s.wr.SetMaxOpenConns(1) // SQLite has one writer; queue in Go instead of busy-waiting
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /stations/{sid}/sales", func(w http.ResponseWriter, r *http.Request) {
		org, sid, err := ids(r)
		if err != nil {
			fail(w, err)
			return
		}
		lim, _ := strconv.ParseInt(r.URL.Query().Get("limit"), 10, 64)
		if lim <= 0 || lim > 200 {
			lim = 50
		}
		out, err := s.list(r.Context(), org, sid, lim)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, 200, out)
	})
	mux.HandleFunc("GET /stations/{sid}/summary", func(w http.ResponseWriter, r *http.Request) {
		org, sid, err := ids(r)
		if err != nil {
			fail(w, err)
			return
		}
		out, err := s.summary(r.Context(), org, sid, r.URL.Query().Get("day"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, 200, out)
	})
	mux.HandleFunc("POST /stations/{sid}/sales", func(w http.ResponseWriter, r *http.Request) {
		org, sid, err := ids(r)
		if err != nil {
			fail(w, err)
			return
		}
		var in In
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			fail(w, httpErr{400, "json"})
			return
		}
		out, err := s.create(r.Context(), org, sid, in)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, 201, out)
	})
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	http.ListenAndServe("127.0.0.1:"+port, mux)
}
