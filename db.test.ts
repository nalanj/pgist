import assert from "node:assert";
import { after, before, test } from "node:test";
import { pgist } from "./db.js";
import { ExactlyOneError } from "./errors.js";
import { databaseUrl } from "./test-help.js";

const db = pgist({
	connectionString: databaseUrl,
	allowExitOnIdle: true,
	connectionTimeoutMillis: 3000,
});

before(async () => {
	await db.query`CREATE TABLE IF NOT EXISTS db_testing (id SERIAL NOT NULL, name TEXT NOT NULL)`;
});

type DbTesting = {
	id: number;
	name: string;
};

after(async () => {
	await db.query<DbTesting>`DELETE FROM db_testing`;
	db.end();
});

test("query", async () => {
	const result =
		await db.query<DbTesting>`INSERT INTO db_testing(name) VALUES (${"Jimmy"}) RETURNING *`;

	const rows = Array.from(result);
	assert.ok(rows[0]);
	assert.deepStrictEqual(rows, [{ id: rows[0].id, name: "Jimmy" }]);
});

test("one", async () => {
	const result =
		await db.one<DbTesting>`INSERT INTO db_testing(name) VALUES (${"Sally"}), (${"Jimmy"}) RETURNING *`;

	assert.ok(result);
	assert.deepStrictEqual(result, { id: result.id, name: "Sally" });
});

test("onlyOne with results", async () => {
	const result =
		await db.onlyOne<DbTesting>`INSERT INTO db_testing(name) VALUES (${"Sally"}), (${"Jimmy"}) RETURNING *`;

	assert.deepStrictEqual(result, { id: result.id, name: "Sally" });
});

test("onlyOne without results", async () => {
	await assert.rejects(
		async () => await db.onlyOne`SELECT * FROM db_testing WHERE id = -1`,
		ExactlyOneError,
	);
});

test("tx with success", async () => {
	const inserted: DbTesting | null = await db.tx(async (c) => {
		return await c.one<DbTesting>`INSERT INTO db_testing(name) VALUES (${"Tx Sally"}) RETURNING *`;
	});

	assert.ok(inserted);

	const result =
		await db.one`SELECT * FROM db_testing WHERE id = ${inserted.id}`;

	assert.deepStrictEqual(result, { id: inserted.id, name: "Tx Sally" });
});

test("tx with rollback", async () => {
	const inserted = await db.tx(async (tx) => {
		const txInserted =
			await tx.one<DbTesting>`INSERT INTO db_testing(name) VALUES (${"Tx Sally"}) RETURNING *`;
		await tx.rollback();
		return txInserted;
	});

	assert.ok(inserted);

	const result =
		await db.one`SELECT * FROM db_testing WHERE id = ${inserted.id}`;
	assert.strictEqual(result, null);
});

test("tx with exception", async () => {
	let caught = false;
	let inserted: DbTesting | null;

	try {
		await db.tx(async (tx) => {
			inserted =
				await tx.one<DbTesting>`INSERT INTO db_testing(name) VALUES (${"Tx Sally"}) RETURNING *`;
			throw new Error("Something broke");
		});
	} catch {
		caught = true;
	}

	// since ts doesn't infer the type across the function boundary
	inserted ||= null;

	assert.strictEqual(caught, true);

	assert.ok(inserted);

	const result =
		await db.one`SELECT * FROM db_testing WHERE id = ${inserted.id}`;
	assert.strictEqual(result, null);
});
