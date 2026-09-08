import type { PackRecord, ProjectDocument } from '../../types/domain'

export type ResourceKind = 'project' | 'pack'
export type SyncValue = ProjectDocument | PackRecord
export type PendingOperation = { operationId: string; value: SyncValue | null }
export type SyncEntry = {
  key: string
  kind: ResourceKind
  id: string
  baseRevision: number
  pending: PendingOperation[]
  notice?: string
}
export type RemoteResource = {
  kind: ResourceKind
  id: string
  revision: number
  deleted: boolean
  value: SyncValue
}
export type CommitResult = { resource: RemoteResource; original?: RemoteResource; conflict: boolean }
export type BinaryReference = {
  key: string
  kind: 'asset' | 'mask'
  hash: string
  metadata: unknown
}
