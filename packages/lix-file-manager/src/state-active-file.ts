/**
 * State atoms for an active file
 */

import { atom } from "jotai";
import {
	lixAtom,
	fileIdSearchParamsAtom,
	withPollingAtom,
	currentVersionAtom,
	discussionSearchParamsAtom,
} from "./state.ts";
import Papa from "papaparse";
import {
	changeConflictInVersion,
	changeHasLabel,
	changeInVersion,
	changeIsLeafInVersion,
	jsonArrayFrom,
	sql,
} from "@lix-js/sdk";
import { CellSchemaV1 } from "@lix-js/plugin-csv";
import { redirect } from "react-router-dom";

export const activeFileAtom = atom(async (get) => {
	get(withPollingAtom);
	const fileId = await get(fileIdSearchParamsAtom);

	if (!fileId) {
		redirect("/");
		return null;
	}

	const lix = await get(lixAtom);

	const fileAtom = await lix.db
		.selectFrom("file")
		.selectAll()
		.where("id", "=", fileId)
		.executeTakeFirst();

	if (!fileAtom) {
		redirect("/");
		return null;
	}
	return fileAtom;
});

export const parsedCsvAtom = atom(async (get) => {
	const file = await get(activeFileAtom);
	if (!file) throw new Error("No file selected");
	const data = await new Blob([file.data]).text();
	const parsed = Papa.parse(data, { header: true });
	return parsed as Papa.ParseResult<Record<string, string>>;
});

export const uniqueColumnAtom = atom<Promise<string | undefined>>(
	async (get) => {
		const file = await get(activeFileAtom);
		if (!file) return undefined;
		return file.metadata?.unique_column as string | undefined;
	}
);

/**
 * The entity id that is selected in the editor.
 */
export const activeCellAtom = atom<{
	colId?: string;
	col: number;
	row: number;
} | null>(null);

/**
 * The entity (row) id that is selected in the editor.
 */
export const activeRowEntityIdAtom = atom(async (get) => {
	const activeCell = get(activeCellAtom);
	const parsedCsv = await get(parsedCsvAtom);
	const uniqueColumn = await get(uniqueColumnAtom);
	if (!activeCell || !uniqueColumn) return null;
	const uniqueColumnValue = parsedCsv.data[activeCell.row]?.[uniqueColumn];
	return `${uniqueColumn}|${uniqueColumnValue}`;
});

/**
 * The cell entity_id that is selected in the editor.
 */
export const activeCellEntityIdAtom = atom(async (get) => {
	const activeCell = get(activeCellAtom);
	const parsedCsv = await get(parsedCsvAtom);
	const activeRowEntityId = await get(activeRowEntityIdAtom);
	if (!activeCell || !activeRowEntityId) return null;
	const columName = parsedCsv.meta.fields![activeCell.col];
	return `${activeRowEntityId}|${columName}`;
});

/**
 * All changes for a given row.
 */
export const activeCellChangesAtom = atom(async (get) => {
	get(withPollingAtom);
	const activeFile = await get(activeFileAtom);
	if (!activeFile) return [];
	const cellEntityId = await get(activeCellEntityIdAtom);
	const currentBranch = await get(currentVersionAtom);
	if (!currentBranch) return [];
	const lix = await get(lixAtom);
	if (!cellEntityId) return [];
	const changes = await lix.db
		.selectFrom("change")
		.where("change.schema_key", "=", CellSchemaV1.key)
		.where("change.entity_id", "=", cellEntityId)
		.where("change.file_id", "=", activeFile.id)
		.where(changeInVersion(currentBranch))
		.innerJoin("snapshot", "snapshot.id", "change.snapshot_id")
		// .innerJoin("change_set_item", "change_set_item.change_id", "change.id")
		// .innerJoin("change_set", "change_set.id", "change_set_item.change_set_id")
		// .innerJoin("discussion", "discussion.change_set_id", "change_set.id")
		// .innerJoin("comment", "comment.discussion_id", "discussion.id")
		// .selectAll("change")
		// .select((eb) => eb.fn.count("comment.id").as("comment_count"))
		.select("snapshot.content")
		.selectAll("change")
		.orderBy("change.created_at", "desc")
		.execute();

	for (const change of changes) {
		const labels = await lix.db
			.selectFrom("label")
			.innerJoin("change_set_label", "change_set_label.label_id", "label.id")
			.innerJoin(
				"change_set",
				"change_set.id",
				"change_set_label.change_set_id"
			)
			.innerJoin(
				"change_set_element",
				"change_set_element.change_set_id",
				"change_set.id"
			)
			.where("change_set_element.change_id", "=", change.id)
			.select("label.name")
			.execute();

		// @ts-expect-error - labels is not in the type
		change.labels = labels.map((label) => label.name);
	}
	return changes;
});

// The file manager app treats changes that are not in a change set as intermediate changes.
export const intermediateChangesAtom = atom(async (get) => {
	get(withPollingAtom);
	const lix = await get(lixAtom);
	const activeFile = await get(activeFileAtom);
	if (!activeFile) return [];
	const currentBranch = await get(currentVersionAtom);
	if (!currentBranch) return [];
	return await lix.db
		.selectFrom("change")
		.where("change.file_id", "=", activeFile.id)
		.where(changeIsLeafInVersion(currentBranch))
		.where((eb) => eb.not(changeHasLabel("checkpoint")))
		.selectAll("change")
		.execute();
});

export const allChangesAtom = atom(async (get) => {
	get(withPollingAtom);
	const lix = await get(lixAtom);
	const currentBranch = await get(currentVersionAtom);
	if (!currentBranch) return [];
	return await lix.db
		.selectFrom("change")
		.innerJoin("snapshot", "snapshot.id", "change.snapshot_id")
		.innerJoin("file", "file.id", "change.file_id")
		.innerJoin("change_author", "change_author.change_id", "change.id")
		.innerJoin("account", "account.id", "change_author.account_id")
		.where(changeInVersion(currentBranch))
		.selectAll("change")
		.select("snapshot.content as snapshot_content")
		.select("file.path as file_path")
		.select("account.name as account_name")
		.orderBy("change.created_at", "desc")
		.execute();
});

export const allChangesDynamicGroupingAtom = atom(async (get) => {
	get(withPollingAtom);
	const lix = await get(lixAtom);
	const currentBranch = await get(currentVersionAtom);
	if (!currentBranch) return [];
	const allChanges = await lix.db
		.selectFrom("change")
		.innerJoin("snapshot", "snapshot.id", "change.snapshot_id")
		.innerJoin("file", "file.id", "change.file_id")
		.innerJoin("change_author", "change_author.change_id", "change.id")
		.innerJoin("account", "account.id", "change_author.account_id")
		.where(changeInVersion(currentBranch))
		.selectAll("change")
		.select("snapshot.content as snapshot_content")
		.select("file.path as file_path")
		.select("account.name as account_name")
		.orderBy("change.created_at", "desc")
		.execute();

	// groupe the changes array by same created_at dates
	const groupedChanges: { [key: string]: typeof allChanges } = {};
	for (const change of allChanges) {
		const createdAt = change.created_at;
		if (!groupedChanges[createdAt]) {
			groupedChanges[createdAt] = [];
		}
		groupedChanges[createdAt].push(change);
	}

	return groupedChanges;
});

export const changesCurrentVersionAtom = atom(async (get) => {
	get(withPollingAtom);
	const lix = await get(lixAtom);
	const activeFile = await get(activeFileAtom);
	if (!activeFile) return [];
	const currentBranch = await get(currentVersionAtom);
	if (!currentBranch) return [];
	return await lix.db
		.selectFrom("change")
		.where("change.file_id", "=", activeFile.id)
		.innerJoin("snapshot", "snapshot.id", "change.snapshot_id")
		.innerJoin("file", "file.id", "change.file_id")
		.innerJoin("change_author", "change_author.change_id", "change.id")
		.innerJoin("account", "account.id", "change_author.account_id")
		.leftJoin("change_edge", "change_edge.child_id", "change.id")
		.leftJoin(
			"change as parent_change",
			"parent_change.id",
			"change_edge.parent_id"
		)
		.leftJoin(
			"snapshot as parent_snapshot",
			"parent_snapshot.id",
			"parent_change.snapshot_id"
		)
		.leftJoin("change_set_element", "change_set_element.change_id", "change.id")
		.leftJoin(
			"discussion",
			"discussion.change_set_id",
			"change_set_element.change_set_id"
		)
		.where(changeInVersion(currentBranch))
		.selectAll("change")
		.select(sql`json(snapshot.content)`.as("snapshot_content"))
		.select("file.path as file_path")
		.select("account.name as account_name")
		.select(sql`json(parent_snapshot.content)`.as("parent_snapshot_content")) // This will be NULL if no parent exists
		.select((eb) => eb.fn.count("discussion.id").as("discussion_count"))
		.select(sql`group_concat(discussion.id)`.as("discussion_ids"))
		.groupBy("change.id")
		.orderBy("change.created_at", "desc")
		.execute();
});

export const allEdgesAtom = atom(async (get) => {
	get(withPollingAtom);
	const lix = await get(lixAtom);
	const activeFile = await get(activeFileAtom);
	if (!activeFile) return [];
	return await lix.db
		.selectFrom("change_edge")
		.innerJoin("change", "change.id", "change_edge.parent_id")
		.where("change.file_id", "=", activeFile.id)
		.selectAll("change_edge")
		.execute();
});

export const changeConflictsAtom = atom(async (get) => {
	get(withPollingAtom);
	const lix = await get(lixAtom);
	const activeFile = await get(activeFileAtom);
	if (!activeFile) return [];
	const currentBranch = await get(currentVersionAtom);
	if (!currentBranch) return [];
	const changeConflictElements = await lix.db
		.selectFrom("change_set_element")
		.innerJoin(
			"change_conflict",
			"change_conflict.change_set_id",
			"change_set_element.change_set_id"
		)
		.innerJoin("change", "change.id", "change_set_element.change_id")
		.innerJoin("snapshot", "snapshot.id", "change.snapshot_id")
		.leftJoin("version_change", (join) =>
			join
				.onRef("version_change.change_id", "=", "change.id")
				.on("version_change.version_id", "=", currentBranch.id)
		)
		.where("change.file_id", "=", activeFile.id)
		.where(changeConflictInVersion(currentBranch))
		.selectAll("change_set_element")
		.select([
			"change_conflict.id as change_conflict_id",
			"change_conflict.change_set_id as change_conflict_change_set_id",
		])
		.selectAll("change")
		.select((eb) =>
			eb
				.case()
				.when("version_change.change_id", "is not", null)
				// using boolean still returns 0 or 1
				// for typesafety, number is used
				.then(1)
				.else(0)
				.end()
				.as("is_current_version_change")
		)
		.select((eb) =>
			eb
				.case()
				.when(changeInVersion(currentBranch))
				.then(1)
				.else(0)
				.end()
				.as("is_in_current_version")
		)
		.select("snapshot.content as snapshot_content")
		.select("change_conflict.key as change_conflict_key")
		.execute();

	const groupedByConflictId: { [key: string]: typeof changeConflictElements } =
		{};

	for (const element of changeConflictElements) {
		const conflictId = element.change_conflict_id;
		if (!groupedByConflictId[conflictId]) {
			groupedByConflictId[conflictId] = [];
		}
		groupedByConflictId[conflictId].push(element);
	}

	return groupedByConflictId;
});

export const selectedChangeIdsAtom = atom<string[]>([]);

export const activeDiscussionAtom = atom(async (get) => {
	const lix = await get(lixAtom);
	const currentVersion = await get(currentVersionAtom);
	const activeFile = await get(activeFileAtom);
	const fileIdSearchParams = await get(fileIdSearchParamsAtom);
	if (!activeFile || !fileIdSearchParams || !currentVersion) return null;
	const discussionSearchParams = await get(discussionSearchParamsAtom);
	if (!discussionSearchParams) return null;

	// Fetch the discussion and its comments in a single query
	const discussionWithComments = await lix.db
		.selectFrom("discussion")
		.where("discussion.id", "=", discussionSearchParams)
		.select((eb) => [
			"discussion.id",
			jsonArrayFrom(
				eb
					.selectFrom("comment")
					.innerJoin("change", (join) =>
						join
							.onRef("change.entity_id", "=", "comment.id")
							.on("change.schema_key", "=", "lix_comment_table")
					)
					.where(changeInVersion(currentVersion))
					.leftJoin("change_author", "change_author.change_id", "change.id")
					.innerJoin("account", "account.id", "change_author.account_id")
					.select([
						"comment.id",
						"comment.content",
						"change.created_at",
						"account.id as account_id",
						"account.name as account_name",
						// "comment.created_at",
						// "account.id as account_id",
						// "account.name as account_name",
					])
					.whereRef("comment.discussion_id", "=", "discussion.id")
					.orderBy("change.created_at", "asc")
			).as("comments"),
		])
		.execute();

	if (!discussionWithComments.length) return null;

	return discussionWithComments[0];
});
