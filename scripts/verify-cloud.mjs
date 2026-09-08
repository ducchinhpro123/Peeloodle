// Real ordinary-client authorization and compare-and-set checks. No email is sent.
// Provision two dedicated test accounts, then use node --env-file=.env.cloud-test scripts/verify-cloud.mjs.
import assert from 'node:assert/strict'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import console from 'node:console'
import { randomUUID, createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const { SUPABASE_TEST_URL: url, SUPABASE_TEST_KEY: key, SUPABASE_TEST_EMAIL_A: emailA, SUPABASE_TEST_EMAIL_B: emailB, SUPABASE_TEST_PASSWORD: password } = process.env
assert(url && key && emailA && emailB && password, 'Provide dedicated test-account configuration (never frontend service keys)')
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
const a = client(), b = client(), anon = client()
const login = async (actor, email) => {
  const { data, error } = await actor.auth.signInWithPassword({ email, password })
  assert.ifError(error)
  return data.user.id
}
const ownerA = await login(a, emailA), ownerB = await login(b, emailB)
assert.notEqual(ownerA, ownerB)
const now = new Date().toISOString()
const document = { schemaVersion: 1, id: randomUUID(), title: 'Authorization fixture', artboard: { width: 1024, height: 1024, background: 'transparent' }, layers: [], assetIds: [], createdAt: now, updatedAt: now, revision: 0 }
const operation = (body, base = 0, kind = 'project', id = body?.id ?? document.id) => ({ operation_id: randomUUID(), resource_kind: kind, resource_id: id, expected_revision: base, body, binaries: [] })
const commit = async (actor, args) => {
  const result = await actor.rpc('commit_sticker_resource', args)
  assert.ifError(result.error)
  return result.data
}
const initial = operation(document)
assert.equal((await commit(a, initial)).resource.revision, 1)
assert.deepEqual(await commit(a, initial), await commit(a, initial), 'lost response retry has one receipt')
assert((await a.rpc('commit_sticker_resource', { ...initial, body: { ...document, title: 'Different retry' } })).error)
for (const other of [b, anon]) {
  const listed = await other.from('projects').select('*').eq('id', document.id)
  assert(listed.error || listed.data.length === 0, 'other accounts cannot read or list A')
  assert((await other.from('projects').insert({ owner_id: ownerA, id: randomUUID(), document })).error)
  const updated = await other.from('projects').update({ owner_id: ownerB }).eq('id', document.id)
  assert(updated.error || updated.data === null)
  const deleted = await other.from('projects').delete().eq('id', document.id)
  assert(deleted.error || deleted.data === null)
}
assert((await anon.rpc('commit_sticker_resource', operation(document))).error)
const forgedPack = { id: randomUUID(), title: 'Forged membership', description: '', visibility: 'private', projectIds: [document.id], createdAt: now, updatedAt: now }
assert((await b.rpc('commit_sticker_resource', operation(forgedPack, 0, 'pack'))).error, 'B cannot refer to A project')
assert.equal((await a.from('projects').select('revision').eq('id', document.id).single()).data.revision, 1)

const competing = await Promise.all([
  commit(a, operation({ ...document, title: 'Concurrent A' }, 1)),
  commit(a, operation({ ...document, title: 'Concurrent B' }, 1)),
])
assert.equal(competing.filter((result) => result.conflict).length, 1)
assert.equal(competing.filter((result) => !result.conflict).length, 1)
const staleDelete = await commit(a, operation(null, 1))
assert.equal(staleDelete.conflict, true)
assert.equal(staleDelete.resource.deleted, false)
await commit(a, operation(null, 2))
const resurrect = await commit(a, operation({ ...document, title: 'Offline after delete' }, 2))
assert.equal(resurrect.conflict, true)
assert.equal(resurrect.original.deleted, true)
assert.notEqual(resurrect.resource.id, document.id)

const second = { ...document, id: randomUUID(), title: 'Pack member' }
await commit(a, operation(second))
const pack = { ...forgedPack, id: randomUUID(), title: 'Ordered pack', projectIds: [second.id, resurrect.resource.id] }
await commit(a, operation(pack, 0, 'pack'))
const [packA, packB] = await Promise.all([
  commit(a, operation({ ...pack, title: 'Renamed pack' }, 1, 'pack')),
  commit(a, operation({ ...pack, projectIds: [...pack.projectIds].reverse() }, 1, 'pack')),
])
assert.equal(Number(packA.conflict) + Number(packB.conflict), 1)
for (const saved of [packA.resource, packB.resource]) {
  const { data, error } = await a.from('pack_items').select('project_id').eq('pack_id', saved.id).order('position')
  assert.ifError(error)
  assert.deepEqual(data.map((row) => row.project_id), saved.value.projectIds)
}
assert((await a.rpc('commit_sticker_resource', operation({ ...pack, id: randomUUID(), projectIds: [second.id, second.id] }, 0, 'pack'))).error, 'duplicate membership rejected')
await commit(a, operation(null, 2, 'pack', pack.id))
assert.equal((await a.from('projects').select('deleted').eq('id', second.id).single()).data.deleted, false)

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const hash = createHash('sha256').update(png).digest('hex')
const path = `${ownerA}/${hash}`
const bucket = 'stickerlab-private'
const upload = await a.storage.from(bucket).upload(path, png, { contentType: 'image/png', upsert: false })
assert(!upload.error || String(upload.error.statusCode) === '409', upload.error?.message)
assert.equal((await a.storage.from(bucket).download(path)).error, null)
for (const other of [b, anon]) {
  assert((await other.storage.from(bucket).download(path)).error, 'guessed private object path is blocked')
  const list = await other.storage.from(bucket).list(ownerA)
  assert(list.error || list.data.length === 0)
  assert((await other.storage.from(bucket).upload(`${ownerA}/${'a'.repeat(64)}`, png, { contentType: 'image/png' })).error)
  assert((await other.storage.from(bucket).update(path, png, { contentType: 'image/png' })).error)
  const remove = await other.storage.from(bucket).remove([path])
  assert(remove.error || remove.data.length === 0)
}
assert((await a.storage.from(bucket).update(path, png, { contentType: 'image/png' })).error, 'even owners cannot mutate committed bytes')
assert.equal((await a.storage.from(bucket).download(path)).error, null)
const assetId = randomUUID(), maskKey = randomUUID()
const image = { ...document, id: randomUUID(), assetIds: [assetId], layers: [{ id: 'image', kind: 'image', name: 'Private photo', assetId, maskKey, transform: { x: 0, y: 0, rotation: 30, scaleX: 1, scaleY: 1 }, opacity: 1, visible: true, locked: false }] }
const imageOp = operation(image)
imageOp.binaries = [
  { key: assetId, kind: 'asset', hash, metadata: { id: assetId, mimeType: 'image/png', width: 1, height: 1, blobKey: assetId, provenance: 'verification fixture' } },
  { key: maskKey, kind: 'mask', hash, metadata: {} },
]
await commit(a, imageOp)
assert((await b.rpc('commit_sticker_resource', { ...imageOp, operation_id: randomUUID() })).error, 'cross-owner object references fail')
const changedBytes = Buffer.concat([png, Buffer.from([0])])
const changedHash = createHash('sha256').update(changedBytes).digest('hex')
const changedUpload = await a.storage.from(bucket).upload(`${ownerA}/${changedHash}`, changedBytes, { contentType: 'image/png' })
assert(!changedUpload.error || String(changedUpload.error.statusCode) === '409')
assert((await a.rpc('commit_sticker_resource', { ...operation(image, 1), binaries: imageOp.binaries.map((binary) => ({ ...binary, hash: changedHash })) })).error, 'logical asset/mask identities cannot be rebound to different bytes')
assert((await a.rpc('commit_sticker_resource', { ...operation({ ...image, id: randomUUID() }), binaries: [] })).error, 'incomplete uploads cannot publish')
const malformed = { ...document, id: randomUUID(), schemaVersion: 2 }
assert((await a.rpc('commit_sticker_resource', operation(malformed))).error)
console.log('PASS: real A/B/anonymous database + Storage isolation, immutable uploads, validated publication, atomic project/pack conflicts, tombstones, ordering, and idempotent retries.')
await Promise.all([a.auth.signOut(), b.auth.signOut()])
