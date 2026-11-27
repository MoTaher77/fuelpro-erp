declare module 'sql.js' {
  interface Statement { bind(p: unknown[]): void; step(): boolean; getAsObject(): Record<string, unknown>; free(): void }
  interface Database { prepare(sql: string): Statement; exec(sql: string): Array<{ values: unknown[][] }>; getRowsModified(): number }
  const init: (o: { locateFile(f: string): string }) => Promise<{ Database: new () => Database }>;
  export default init;
}
