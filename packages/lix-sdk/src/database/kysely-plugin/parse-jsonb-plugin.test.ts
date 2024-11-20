import { Kysely, sql, type Generated } from "kysely";
import { expect, test } from "vitest";
import { createDialect, createInMemoryDatabase } from "sqlite-wasm-kysely";
import { ParseJsonBPlugin } from "./parse-jsonb-plugin.js";

test("should transform a selectAll that contains a json column", async () => {
	const db = await mockDatabase();

	await db
		.insertInto("mock_table")
		.values({
			json_column: new TextEncoder().encode(JSON.stringify({ a: 1 })),
			other: "value",
			just_blob: new TextEncoder().encode("{mock blob value that's not a json"),
		})
		.execute();

	const result = await db
		.selectFrom("mock_table")
		.selectAll()
		.executeTakeFirst();

	expect(result?.json_column).toStrictEqual({ a: 1 });
	expect(result?.other).toBe("value");
	expect(result?.just_blob).toBeInstanceOf(Uint8Array);
});

test("should transform a selectAll that is aliased", async () => {
	const db = await mockDatabase();

	await db
		.insertInto("mock_table")
		.values({
			json_column: new TextEncoder().encode(JSON.stringify({ a: 1 })),
			other: "value",
			just_blob: new TextEncoder().encode("{mock blob value that's not a json"),
		})
		.execute();

	const result = await db
		.selectFrom("mock_table as mt")
		.selectAll("mt")
		.executeTakeFirst();

	expect(result?.json_column).toStrictEqual({ a: 1 });
	expect(result?.other).toBe("value");
	expect(result?.just_blob).toBeInstanceOf(Uint8Array);
});

test("selectAll should work with joins", async () => {
	const db = await mockDatabase();

	const insert = await db
		.insertInto("mock_table")
		.values({
			json_column: new TextEncoder().encode(JSON.stringify({ a: 1 })),
			other: "value",
			just_blob: new TextEncoder().encode("{mock blob value that's not a json"),
		})
		.returningAll()
		.executeTakeFirstOrThrow();

	await db
		.insertInto("other_table")
		.values({
			mock_table_id: insert.id,
			json_column: new TextEncoder().encode(JSON.stringify({ a: 1 })),
		})
		.execute();

	const result = await db
		.selectFrom("mock_table")
		.innerJoin("other_table", "mock_table.id", "other_table.mock_table_id")
		.selectAll("mock_table")
		.executeTakeFirst();

	console.log(result);

	expect(result?.json_column).toStrictEqual({ a: 1 });
	expect(result?.other).toBe("value");
	expect(result?.just_blob).toBeInstanceOf(Uint8Array);
});

const mockDatabase = async () => {
	const database = await createInMemoryDatabase({ readOnly: false });

	const db = new Kysely<{
		mock_table: {
			id: Generated<number>;
			json_column: Record<string, any>;
			other: string;
			just_blob: Uint8Array;
		};
		other_table: {
			mock_table_id: number;
			json_column: Record<string, any>;
		};
	}>({
		dialect: createDialect({
			database,
		}),
		plugins: [
			ParseJsonBPlugin({
				mock_table: ["json_column"],
				other_table: ["json_column"],
			}),
		],
	});

	await sql`
		CREATE TABLE mock_table (
	    id INTEGER PRIMARY KEY AUTOINCREMENT,
			json_column BLOB,
			other TEXT,
			just_blob BLOB
		) strict;

		CREATE TABLE other_table (
		  mock_table_id INTEGER,
			json_column BLOB,

			FOREIGN KEY (mock_table_id) REFERENCES mock_table (id)
		) strict;
	`.execute(db);

	return db;
};
