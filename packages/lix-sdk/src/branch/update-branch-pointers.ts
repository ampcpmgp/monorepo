import type { Branch, Change, ChangeConflict } from "../database/schema.js";
import type { Lix } from "../lix/open-lix.js";

/**
 * Updates the branch pointers for the given branch with the given changes.
 *
 * @args branch - The branch to update the pointers for. If not provided, the current branch is used.
 */
export async function updateBranchPointers(args: {
	lix: Pick<Lix, "db" | "plugin">;
	changes?: Change[];
	changeConflicts?: ChangeConflict[];
	branch: Pick<Branch, "id" | "change_set_id">;
}): Promise<void> {
	const executeInTransaction = async (trx: Lix["db"]) => {
		for (const change of args.changes ?? []) {
			// Change for the same entity_id, schema_key and file_id should be unique
			const existingEntityChange = await trx
				.selectFrom("change")
				.innerJoin(
					"change_set_element",
					"change.id",
					"change_set_element.change_id",
				)
				.where(
					"change_set_element.change_set_id",
					"=",
					args.branch.change_set_id,
				)
				.where("change.schema_key", "=", change.schema_key)
				.where("change.entity_id", "=", change.entity_id)
				.where("change.file_id", "=", change.file_id)
				.selectAll()
				.executeTakeFirst();

			if (existingEntityChange) {
				// update the existing pointer
				await trx
					.updateTable("change_set_element")
					.set("change_id", change.id)
					.where("change_set_id", "=", args.branch.change_set_id)
					.where("change_id", "=", existingEntityChange.id)
					.execute();
			} else {
				// create a new pointer
				await trx
					.insertInto("change_set_element")
					.values({
						change_set_id: args.branch.change_set_id,
						change_id: change.id,
					})
					.execute();
			}
		}

		if (args.changeConflicts) {
			const changeConflictPointers = args.changeConflicts?.map((conflict) => ({
				branch_id: args.branch.id,
				change_conflict_id: conflict.id,
			}));
			if (changeConflictPointers.length > 0) {
				await trx
					.insertInto("branch_change_conflict_pointer")
					.values(
						args.changeConflicts?.map((conflict) => ({
							branch_id: args.branch.id,
							change_conflict_id: conflict.id,
						})) ?? [],
					)
					.onConflict((oc) => oc.doNothing())
					.execute();
			} else if (changeConflictPointers.length === 0) {
				// if there are no conflicts, then delete all pointers for the branch
				await trx
					.deleteFrom("branch_change_conflict_pointer")
					.where("branch_id", "=", args.branch.id)
					.execute();
			}
		}

		// await updateChangeConflicts({
		// 	lix: { ...args.lix, db: trx },
		// 	branch,
		// });
	};

	if (args.lix.db.isTransaction) {
		await executeInTransaction(args.lix.db);
	} else {
		await args.lix.db.transaction().execute(executeInTransaction);
	}

	// await garbageCollectChangeConflicts({ lix: args.lix });
}
