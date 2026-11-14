import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

/** Creates a connection pool. BIGINT columns are parsed as JS numbers (amounts in tiyin fit safely). */
export function createDb(url: string, opts: { max?: number } = {}): Sql {
  return postgres(url, {
    max: opts.max ?? 10,
    onnotice: () => {},
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (x: number | bigint) => x.toString(),
        parse: (x: string) => Number(x),
      },
    },
  });
}
