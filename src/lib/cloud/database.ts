// Ported from the source `src/types/database.ts` (generated from the project's
// Supabase schema), extended with the catalog tables and RPCs added by
// `supabase/migrations/2026091612*.sql`. Public schema retained; unused
// generated convenience aliases omitted. This is a client-side contract only —
// no service credential is read here, and the existing owner RLS and private
// Storage policies are unchanged.
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
			// Catalog tables are read-only through PostgREST: every catalog write is a
			// guarded security-definer RPC, so Insert/Update are intentionally `never`.
			catalog_admins: {
				Row: { created_at: string; created_by: string | null; user_id: string };
				Insert: never;
				Update: never;
				Relationships: [];
			};
			catalog_asset_versions: {
				Row: {
					asset_id: string;
					created_at: string;
					derivative_bytes: number;
					derivative_height: number;
					derivative_mime: string;
					derivative_path: string;
					derivative_sha256: string;
					derivative_width: number;
					id: string;
					source_bytes: number;
					source_mime: string;
					source_path: string;
					source_sha256: string;
					thumbnail_path: string | null;
					thumbnail_sha256: string | null;
					validation: Json;
					validation_state: string;
					version_number: number;
				};
				Insert: never;
				Update: never;
				Relationships: [];
			};
			catalog_assets: {
				Row: {
					archived_at: string | null;
					collection_id: string | null;
					created_at: string;
					description: string;
					id: string;
					kind: string;
					name: string;
					provenance: Json;
					published_at: string | null;
					published_version_id: string | null;
					revision: number;
					sort_order: number;
					state: string;
					tags: string[];
					updated_at: string;
				};
				Insert: never;
				Update: never;
				Relationships: [];
			};
			catalog_collections: {
				Row: {
					archived_at: string | null;
					created_at: string;
					description: string;
					id: string;
					name: string;
					published_at: string | null;
					revision: number;
					sort_order: number;
					state: string;
					tags: string[];
					updated_at: string;
				};
				Insert: never;
				Update: never;
				Relationships: [];
			};
			catalog_events: {
				Row: {
					actor_id: string | null;
					created_at: string;
					detail: Json;
					id: number;
					operation: string;
					outcome: string;
					subject_id: string | null;
					subject_table: string;
				};
				Insert: never;
				Update: never;
				Relationships: [];
			};
			catalog_template_dependencies: {
				Row: { asset_id: string; asset_version_id: string; template_version_id: string };
				Insert: never;
				Update: never;
				Relationships: [];
			};
			catalog_template_versions: {
				Row: {
					cover_path: string | null;
					cover_sha256: string | null;
					created_at: string;
					document: Json;
					document_bytes: number;
					document_sha256: string;
					font_requirements: Json;
					id: string;
					slide_previews: Json;
					template_id: string;
					validation: Json;
					validation_state: string;
					version_number: number;
				};
				Insert: never;
				Update: never;
				Relationships: [];
			};
			catalog_templates: {
				Row: {
					archived_at: string | null;
					created_at: string;
					description: string;
					id: string;
					published_at: string | null;
					published_version_id: string | null;
					revision: number;
					sort_order: number;
					state: string;
					tags: string[];
					title: string;
					updated_at: string;
					use_case: string;
				};
				Insert: never;
				Update: never;
				Relationships: [];
			};
			catalog_upload_batches: {
				Row: {
					created_at: string;
					created_by: string;
					id: string;
					state: string;
					updated_at: string;
				};
				Insert: never;
				Update: never;
				Relationships: [];
			};
			catalog_upload_jobs: {
				Row: {
					asset_id: string | null;
					attempts: number;
					batch_id: string;
					claimed_bytes: number;
					claimed_mime: string;
					created_at: string;
					error_code: string | null;
					error_message: string | null;
					id: string;
					lease_expires_at: string | null;
					lease_token: string | null;
					original_name: string;
					progress: number;
					source_path: string;
					stage: string;
					updated_at: string;
				};
				Insert: never;
				Update: never;
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
			catalog_admin_archive_asset: {
				Args: { expected_revision: number; id: string };
				Returns: Json;
			};
			catalog_admin_archive_collection: {
				Args: { archive_items?: boolean; expected_revision: number; id: string };
				Returns: Json;
			};
			catalog_admin_archive_template: {
				Args: { expected_revision: number; id: string };
				Returns: Json;
			};
			catalog_admin_create_asset: {
				Args: {
					collection_id: string | null;
					description?: string;
					kind: string;
					name: string;
					provenance?: Json;
					sort_order?: number;
					tags?: string[];
				};
				Returns: Json;
			};
			catalog_admin_create_collection: {
				Args: { description?: string; name: string; sort_order?: number; tags?: string[] };
				Returns: Json;
			};
			catalog_admin_create_template: {
				Args: {
					description?: string;
					sort_order?: number;
					tags?: string[];
					title: string;
					use_case: string;
				};
				Returns: Json;
			};
			catalog_admin_create_template_draft: {
				Args: {
					p_description?: string;
					p_document: Json;
					p_document_bytes: number;
					p_document_sha256: string;
					p_font_requirements?: Json;
					p_sort_order?: number;
					p_tags?: string[];
					p_title: string;
					p_use_case: string;
				};
				Returns: Json;
			};
			catalog_admin_save_template_version: {
				Args: {
					p_document: Json;
					p_document_bytes: number;
					p_document_sha256: string;
					p_expected_revision: number;
					p_font_requirements?: Json;
					p_template_id: string;
				};
				Returns: Json;
			};
			catalog_admin_validate_template_version: {
				Args: { p_expected_revision: number; p_template_id: string; p_version_id: string };
				Returns: Json;
			};
			catalog_admin_attach_template_previews: {
				Args: {
					p_cover_ordinal: number;
					p_document_sha256: string;
					p_expected_revision: number;
					p_previews: Json;
					p_template_id: string;
					p_version_id: string;
				};
				Returns: Json;
			};
			catalog_admin_publish_asset: {
				Args: { expected_revision: number; id: string; version_id: string };
				Returns: Json;
			};
			catalog_admin_publish_collection: {
				Args: { expected_revision: number; id: string };
				Returns: Json;
			};
			catalog_admin_publish_template: {
				Args: { expected_revision: number; id: string; version_id: string };
				Returns: Json;
			};
			catalog_admin_update_asset: {
				Args: {
					collection_id: string | null;
					description: string | null;
					expected_revision: number;
					id: string;
					name: string | null;
					sort_order: number | null;
					tags: string[] | null;
				};
				Returns: Json;
			};
			catalog_admin_update_collection: {
				Args: {
					description: string | null;
					expected_revision: number;
					id: string;
					name: string | null;
					sort_order: number | null;
					tags: string[] | null;
				};
				Returns: Json;
			};
			catalog_admin_update_template: {
				Args: {
					description: string | null;
					expected_revision: number;
					id: string;
					sort_order: number | null;
					tags: string[] | null;
					title: string | null;
					use_case: string | null;
				};
				Returns: Json;
			};
			catalog_admin_cancel_upload_batch: {
				Args: { p_batch_id: string };
				Returns: Json;
			};
			catalog_admin_claim_upload_job: {
				Args: { p_job_id?: string | null; p_lease_seconds?: number };
				Returns: Json;
			};
			catalog_admin_close_upload_batch: {
				Args: { p_batch_id: string };
				Returns: Json;
			};
			catalog_admin_complete_upload_job: {
				Args: { p_job_id: string; p_lease_token: string; p_report: Json };
				Returns: Json;
			};
			catalog_admin_create_upload_batch: {
				Args: { p_collection_id: string | null; p_files: Json };
				Returns: Json;
			};
			catalog_admin_fail_upload_job: {
				Args: {
					p_error_code: string;
					p_error_message: string;
					p_job_id: string;
					p_lease_token: string;
				};
				Returns: Json;
			};
			catalog_admin_list_orphan_media: {
				Args: { p_batch_id: string; p_limit?: number };
				Returns: Json;
			};
			catalog_admin_list_upload_batches: {
				Args: { p_before?: string | null; p_before_id?: string | null; p_limit?: number };
				Returns: Json;
			};
			catalog_admin_record_upload_cleanup: {
				Args: { p_batch_id: string; p_paths: string[] };
				Returns: Json;
			};
			catalog_admin_retry_upload_job: {
				Args: { p_job_id: string };
				Returns: Json;
			};
			catalog_admin_upload_status: {
				Args: { p_batch_id: string };
				Returns: Json;
			};
			catalog_is_admin: { Args: Record<string, never>; Returns: boolean };
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
