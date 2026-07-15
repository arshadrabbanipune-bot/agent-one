import assert from 'node:assert/strict';
import { createSession } from '../api/_auth.js';
import handler from '../api/notion/map.js';

process.env.AUTH_SECRET = 'map-route-test-secret';

const json = (value) => ({ ok: true, status: 200, headers: new Headers(), json: async () => value });
const failure = (status, message) => ({ ok: false, status, headers: new Headers(), json: async () => ({ message }) });
const page = (id, title, parent = { type: 'workspace', workspace: true }) => ({
  object: 'page', id, parent,
  properties: { Name: { type: 'title', title: title ? [{ plain_text: title }] : [] } },
  url: `https://app.notion.so/${id}`
});

const root = page('root', 'Root page');
const child = page('child', 'Child page', { type: 'page_id', page_id: 'root' });
const promptLibrary = page('prompt-library', 'Prompt Library', { type: 'page_id', page_id: 'child' });
const recipes = page('recipes', 'Recipes', { type: 'page_id', page_id: 'child' });
const hiddenUntitledPage = page('empty-page', '', { type: 'page_id', page_id: 'root' });
const hiddenUntitledDatabase = { object: 'database', id: 'empty-db', parent: { type: 'workspace', workspace: true }, title: [], url: 'https://app.notion.so/empty-db' };
const unsharedPage = page('unshared-page', 'Not a workspace root', { type: 'page_id', page_id: 'not-shared-parent' });
const database = { object: 'database', id: 'db1', parent: { type: 'page_id', page_id: 'child' }, title: [{ plain_text: 'Work tracker' }], url: 'https://app.notion.so/db1' };
const rowOne = page('row-one', 'First record', { type: 'data_source_id', data_source_id: 'source1' });
rowOne.properties = {
  Name: { type: 'title', title: [{ plain_text: 'First record' }] },
  Status: { type: 'status', status: { name: 'In progress' } },
  URL: { type: 'url', url: 'https://example.test/first' }
};
const rowTwo = page('row-two', '', { type: 'data_source_id', data_source_id: 'source1' });
rowTwo.properties = {
  Name: { type: 'title', title: [] },
  Status: { type: 'status', status: { name: 'Done' } },
  URL: { type: 'url', url: 'https://example.test/second' }
};
const rowChild = page('row-child', 'Row subpage', { type: 'page_id', page_id: 'row-one' });

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const address = new URL(url);
  const path = `${address.pathname}${address.search}`;
  if (path === '/v1/search') {
    const body = JSON.parse(options.body || '{}');
    return body.start_cursor
      ? json({ results: [], has_more: false, next_cursor: null })
      : json({ results: [root, child, promptLibrary, recipes, hiddenUntitledPage, hiddenUntitledDatabase, unsharedPage, database], has_more: true, next_cursor: 'next-search' });
  }
  if (path === '/v1/databases/empty-db') return json({ object: 'database', id: 'empty-db', title: [] });
  if (path === '/v1/databases/empty-db/query') return json({ results: [], has_more: false, next_cursor: null });
  if (path === '/v1/pages/not-shared-parent') return failure(404, 'Parent is not shared');
  if (path === '/v1/databases/db1') return json({ object: 'database', id: 'db1', data_sources: [{ id: 'source1' }], title: [{ plain_text: 'Work tracker' }], url: database.url });
  if (path === '/v1/data_sources/source1') return json({ object: 'data_source', id: 'source1', properties: { Name: { type: 'title' }, Status: { type: 'status' }, URL: { type: 'url' } } });
  if (path === '/v1/data_sources/source1/query') {
    const body = JSON.parse(options.body || '{}');
    return body.start_cursor
      ? json({ results: [rowTwo], has_more: false, next_cursor: null })
      : json({ results: [rowOne], has_more: true, next_cursor: 'next-rows' });
  }
  if (path === '/v1/blocks/root/children?page_size=100') return json({ results: [{ id: 'root-heading', type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Root content' }] } }, { id: 'source-bookmark', type: 'bookmark', bookmark: { url: 'https://example.test/source', caption: [] } }, { id: 'child', type: 'child_page', child_page: { title: 'Child page' } }], has_more: false, next_cursor: null });
  if (path === '/v1/blocks/child/children?page_size=100') return json({ results: [{ id: 'db1', type: 'child_database', child_database: { title: 'Work tracker' } }, { id: 'prompt-library', type: 'child_page', child_page: { title: 'Prompt Library' } }, { id: 'recipes', type: 'child_page', child_page: { title: 'Recipes' } }], has_more: false, next_cursor: null });
  if (path === '/v1/blocks/prompt-library/children?page_size=100') return json({ results: [{ id: 'prompt-block', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'A real prompt-library entry' }] } }], has_more: false, next_cursor: null });
  if (path === '/v1/blocks/recipes/children?page_size=100') return json({ results: [{ id: 'recipe-heading', type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Coffee Recipes' }] } }, { id: 'recipe-step', type: 'numbered_list_item', numbered_list_item: { rich_text: [{ plain_text: 'Prepare the coffee mixture.' }] } }], has_more: false, next_cursor: null });
  if (path === '/v1/blocks/row-one/children?page_size=100') return json({ results: [{ id: 'row-note', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Row body' }] } }, { id: 'row-child', type: 'child_page', child_page: { title: 'Row subpage' } }], has_more: false, next_cursor: null });
  if (path === '/v1/blocks/row-two/children?page_size=100') return json({ results: [{ id: 'row-task', type: 'to_do', to_do: { checked: true, rich_text: [{ plain_text: 'Completed row task' }] } }], has_more: false, next_cursor: null });
  if (path === '/v1/blocks/row-child/children?page_size=100') return json({ results: [], has_more: false, next_cursor: null });
  if (path === '/v1/blocks/unshared-page/children?page_size=100') return json({ results: [], has_more: false, next_cursor: null });
  throw new Error(`Unexpected Notion request: ${path}`);
};

let status = 200;
let body = '';
const response = {
  setHeader() {},
  status(code) { status = code; return this; },
  end(value) { body = value; }
};
const token = createSession({ id: 'test-user' }, { token: 'test-token', workspace: 'Test workspace' });
await handler({ headers: { cookie: `aos_session=${encodeURIComponent(token)}` } }, response);
globalThis.fetch = originalFetch;

const map = JSON.parse(body);
assert.equal(status, 200);
assert.equal(map.partial, true);
assert.equal(map.scanErrors, 1);
assert.deepEqual(map.nodes.workspace.children, ['page_root', 'page_unsharedpage']);
assert.deepEqual(map.nodes.page_root.children, ['page_child']);
assert.deepEqual(map.nodes.page_child.children, ['db_db1', 'page_promptlibrary', 'page_recipes']);
assert.deepEqual(map.nodes.db_db1.children, []);
assert.deepEqual(map.nodes.db_db1.database.rows, ['row_rowone', 'row_rowtwo']);
assert.equal(map.stats.databaseRows, 2, 'live table-row metric must match the rows exposed in the database');
assert.deepEqual(Object.keys(map.nodes.db_db1.database.properties), ['Name', 'Status', 'URL']);
assert.equal(map.nodes.row_rowtwo.title, '');
assert.equal(map.nodes.row_rowone.parentId, 'db_db1');
assert.equal(map.nodes.row_rowtwo.parentId, 'db_db1');
assert.equal(map.nodes.row_rowone.properties.Status.status.name, 'In progress');
assert.equal(map.nodes.row_rowtwo.properties.URL.url, 'https://example.test/second');
assert.equal(map.nodes.page_root.content[0].text, 'Root content');
assert.deepEqual(map.nodes.page_root.content[0].data, { rich_text: [{ plain_text: 'Root content' }] });
assert.equal(map.nodes.page_root.content[1].type, 'bookmark');
assert.equal(map.nodes.page_root.content[1].url, 'https://example.test/source');
assert.equal(map.nodes.page_root.content[1].data.url, 'https://example.test/source');
assert.equal(map.nodes.row_rowone.content[0].text, 'Row body');
assert.equal(map.nodes.row_rowtwo.content[0].checked, true);
assert.deepEqual(map.nodes.row_rowone.children, ['page_rowchild']);
assert.equal(map.nodes.page_rowchild.title, 'Row subpage', 'nested content inside a database row must remain in the map payload');
assert.equal(map.nodes.page_promptlibrary.content[0].text, 'A real prompt-library entry', 'Prompt Library content must not be discarded');
assert.deepEqual(map.nodes.page_recipes.content.map((entry) => entry.text), ['Coffee Recipes', 'Prepare the coffee mixture.'], 'Recipe headings and steps must remain complete');
assert.equal(map.nodes.page_emptypage, undefined);
assert.equal(map.nodes.db_emptydb, undefined);
assert.equal(map.nodes.page_unsharedpage.title, 'Not a workspace root');
assert.match(map.nodes.page_unsharedpage.accessNote, /Shared directly/);
assert.equal(Object.values(map.nodes).some((node) => node.type === 'database_row' && (node.parentId !== 'db_db1' || map.nodes.db_db1.children.includes(node.id))), false);

console.log('notion-map route fixture passed');
