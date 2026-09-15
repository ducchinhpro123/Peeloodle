// Ported from the source `src/types/database.ts` (generated from the project's
// Supabase schema). Public schema retained; unused generated convenience aliases
// omitted. This is a client-side contract only: the target adds no schema,
// migration or service credential, and reuses the existing owner RLS and private
// Storage policies.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
	__InternalSupabase: { PostgrestVersion: '14.5' };
	public: {
		Tables: {
			binary_versions: {
				Row: { hash: string; kind: string; logical_key: string; metadata: Json; owner_id: string };
				Insert: {
					hash: string;
					kind: string;
					logical_key: string;
					metadata: Json;
					owner_id: string;
				};
				Update: {
					hash?: string;
					kind?: string;
					logical_key?: string;
					metadata?: Json;
					owner_id?: string;
				};
				Relationships: [];
			};
			cloud_operations: {
				Row: {
					created_at: string;
					operation_id: string;
					owner_id: string;
					request: Json;
					result: Json;
				};
				Insert: {
					created_at?: string;
					operation_id: string;
					owner_id: string;
					request: Json;
					result: Json;
				};
				Update: {
					created_at?: string;
					operation_id?: string;
					owner_id?: string;
					request?: Json;
					result?: Json;
				};
				Relationships: [];
			};
			pack_items: {
				Row: {
					owner_id: string;
					pack_id: string;
					position: number;
					project_id: string;
				};
				Insert: {
					owner_id: string;
					pack_id: string;
					position: number;
					project_id: string;
				};
				Update: {
					owner_id?: string;
					pack_id?: string;
					position?: number;
					project_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'pack_items_owner_id_pack_id_fkey';
						columns: ['owner_id', 'pack_id'];
						isOneToOne: false;
						referencedRelation: 'packs';
						referencedColumns: ['owner_id', 'id'];
					},
					{
						foreignKeyName: 'pack_items_owner_id_project_id_fkey';
						columns: ['owner_id', 'project_id'];
						isOneToOne: false;
						referencedRelation: 'projects';
						referencedColumns: ['owner_id', 'id'];
					}
				];
			};
			packs: {
				Row: {
					deleted: boolean;
					document: Json;
					id: string;
					owner_id: string;
					revision: number;
					updated_at: string;
				};
				Insert: {
					deleted?: boolean;
					document: Json;
					id: string;
					owner_id: string;
					revision?: number;
					updated_at?: string;
				};
				Update: {
					deleted?: boolean;
					document?: Json;
					id?: string;
					owner_id?: string;
					revision?: number;
					updated_at?: string;
				};
				Relationships: [];
			};
			project_binaries: {
				Row: {
					hash: string;
					kind: string;
					logical_key: string;
					metadata: Json;
					owner_id: string;
					project_id: string;
				};
				Insert: {
					hash: string;
					kind: string;
					logical_key: string;
					metadata: Json;
					owner_id: string;
					project_id: string;
				};
				Update: {
					hash?: string;
					kind?: string;
					logical_key?: string;
					metadata?: Json;
					owner_id?: string;
					project_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'immutable_binary_reference';
						columns: ['owner_id', 'kind', 'logical_key', 'hash'];
						isOneToOne: false;
						referencedRelation: 'binary_versions';
						referencedColumns: ['owner_id', 'kind', 'logical_key', 'hash'];
					},
					{
						foreignKeyName: 'project_binaries_owner_id_project_id_fkey';
						columns: ['owner_id', 'project_id'];
						isOneToOne: false;
						referencedRelation: 'projects';
						referencedColumns: ['owner_id', 'id'];
					}
				];
			};
			projects: {
				Row: {
					deleted: boolean;
					document: Json;
					id: string;
					owner_id: string;
					revision: number;
					updated_at: string;
				};
				Insert: {
					deleted?: boolean;
					document: Json;
					id: string;
					owner_id: string;
					revision?: number;
					updated_at?: string;
				};
				Update: {
					deleted?: boolean;
					document?: Json;
					id?: string;
					owner_id?: string;
					revision?: number;
					updated_at?: string;
				};
				Relationships: [];
			};
		};
		Views: { [_ in never]: never };
		Functions: {
			commit_sticker_resource: {
				Args: {
					binaries?: Json;
					body: Json;
					expected_revision: number;
					operation_id: string;
					resource_id: string;
					resource_kind: string;
				};
				Returns: Json;
			};
			valid_sticker_document: { Args: { body: Json }; Returns: boolean };
		};
		Enums: { [_ in never]: never };
		CompositeTypes: { [_ in never]: never };
	};
};
