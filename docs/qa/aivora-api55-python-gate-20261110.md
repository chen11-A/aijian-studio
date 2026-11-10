# API55 Python 完整门失败分类（2026-11-10）

完整门退出码 1。这里保留失败，不把它记成通过。产品工具锁和 `media_toolchain` 解析器没有改。

## 原门

- 当时产品源码是 `74704d0a6df0f0b450ade19f04fa1f39e4d1f799`。进程启动时 HEAD 是合并提交 `833fd013`，工作树里还有尚未提交的 `test_prepared_generation_cache.py`。
- `pnpm test:py` 停在 Corepack 下载确认，没有进入 pytest。实际命令是该脚本本体：`uv run pytest --cov=aijian_api --cov-report=term-missing --cov-report=json:coverage-python.json && uv run python scripts/check_python_coverage.py coverage-python.json`。
- 结果：`143 failed, 5204 passed, 6 skipped, 100 errors in 1960.27s`，退出码 1。覆盖检查没有执行。
- 原始日志 742555 字节，SHA256 `d35603ee7b3992e74c4db702987fe09f162141230329fff0b7f843e668d9b511`。
- gzip 57198 字节，SHA256 `c161d1b24be7496d894ca0281e7bd9cdaa2899433a8531ecf1cfec91cc588333`。
- 持久副本：`docs/qa/evidence/aivora-api55-full-python-20261110.log.gz`，以及 `/opt/cursor/artifacts/aivora-api55-full-python-20261110.log.gz`。

## 分类

243 个 summary nodeid 各自对应一段 traceback。

### `banner-ncurses-prefix`（202）

tmux 全局环境把 `LD_LIBRARY_PATH=/exec-daemon/tmux-root/lib` 传给测试进程。`ffmpeg -version` 把 stderr 并进 stdout，首行变成 libncursesw 警告，锁定解析器按现有规则拒绝。解析器未改。

- `FAILED services/api/tests/test_draft_export_routes.py::test_draft_route_is_native_authenticated_scoped_and_durable`
- `FAILED services/api/tests/test_draft_export_runtime.py::test_real_encode_receipt_reopen_original_provenance_and_no_overwrite`
- `FAILED services/api/tests/test_draft_export_runtime.py::test_cancel_is_durable_and_never_publishes`
- `FAILED services/api/tests/test_draft_export_runtime.py::test_recovery_marks_active_unknown_without_retry`
- `FAILED services/api/tests/test_draft_export_runtime.py::test_change_after_encode_cannot_publish_false_success[target]`
- `FAILED services/api/tests/test_draft_export_runtime.py::test_change_after_encode_cannot_publish_false_success[original]`
- `FAILED services/api/tests/test_draft_export_runtime.py::test_change_after_encode_cannot_publish_false_success[rights]`
- `FAILED services/api/tests/test_draft_export_runtime.py::test_readback_waits_for_timed_out_submission_before_definite_absence`
- `FAILED services/api/tests/test_episode_media_assembly.py::test_saved_dialogue_recovery_never_restarts`
- `FAILED services/api/tests/test_episode_media_assembly.py::test_dialogue_binding_change_after_encode_never_publishes`
- `FAILED services/api/tests/test_fake_media_package.py::test_materializes_three_verified_fake_shots_and_replays_without_rewriting`
- `FAILED services/api/tests/test_fake_media_package.py::test_same_frozen_input_is_byte_deterministic_across_clean_workspaces`
- `FAILED services/api/tests/test_fake_media_package.py::test_concurrent_same_identity_publishes_one_complete_package`
- `FAILED services/api/tests/test_fake_media_package.py::test_two_spawned_processes_converge_on_one_complete_package`
- `FAILED services/api/tests/test_fake_media_package.py::test_process_crash_recovers_to_one_complete_package[shots_generated]`
- `FAILED services/api/tests/test_fake_media_package.py::test_process_crash_recovers_to_one_complete_package[before_publish]`
- `FAILED services/api/tests/test_fake_media_package.py::test_process_crash_recovers_to_one_complete_package[after_publish]`
- `FAILED services/api/tests/test_fake_media_package.py::test_late_process_does_not_delete_an_active_staging_lease[lease_still_active]`
- `FAILED services/api/tests/test_fake_media_package.py::test_late_process_does_not_delete_an_active_staging_lease[after_staging_lease_removed]`
- `FAILED services/api/tests/test_fake_media_package.py::test_existing_final_junction_outside_workspace_is_rejected`
- `FAILED services/api/tests/test_fake_media_package.py::test_existing_shot_junction_outside_package_is_rejected`
- `FAILED services/api/tests/test_fake_media_package.py::test_existing_media_symlink_outside_package_is_rejected`
- `FAILED services/api/tests/test_fake_media_package.py::test_rechecks_locked_binary_hash_before_materialization`
- `FAILED services/api/tests/test_fake_media_package.py::test_tool_root_junction_is_rejected_before_discovery`
- `FAILED services/api/tests/test_fake_media_package.py::test_preview_byte_hashes_bind_directly_to_the_existing_timeline_export`
- `FAILED services/api/tests/test_fake_media_package.py::test_rename_failure_leaves_no_visible_or_staged_package`
- `FAILED services/api/tests/test_fake_media_package.py::test_rejects_direct_or_non_development_toolchain_before_creating_files`
- `FAILED services/api/tests/test_fake_media_package.py::test_existing_corrupt_package_fails_closed_without_overwriting`
- `FAILED services/api/tests/test_fake_media_package.py::test_rejects_untrusted_identity_before_creating_files[../escape-src_0123456789abcdef0123456789abcdef-sha256:4242424242424242424242424242424242424242424242424242424242424242]`
- `FAILED services/api/tests/test_fake_media_package.py::test_rejects_untrusted_identity_before_creating_files[prj_0123456789abcdef0123456789abcdef-../escape-sha256:4242424242424242424242424242424242424242424242424242424242424242]`
- `FAILED services/api/tests/test_fake_media_package.py::test_rejects_untrusted_identity_before_creating_files[prj_0123456789abcdef0123456789abcdef-src_0123456789abcdef0123456789abcdef-sha256:ABC]`
- `FAILED services/api/tests/test_fake_media_package.py::test_manifest_rejects_noncanonical_extra_fields`
- `FAILED services/api/tests/test_fake_media_package.py::test_locked_generator_rejects_unsafe_workspace_roots[relative-workspace]`
- `FAILED services/api/tests/test_fake_media_package.py::test_locked_generator_rejects_unsafe_workspace_roots[missing-workspace]`
- `FAILED services/api/tests/test_fake_media_package.py::test_locked_generator_rejects_unsafe_workspace_roots[file-workspace]`
- `FAILED services/api/tests/test_fake_media_package.py::test_materialize_rejects_invalid_existing_media_files[empty]`
- `FAILED services/api/tests/test_fake_media_package.py::test_materialize_rejects_invalid_existing_media_files[over-limit]`
- `FAILED services/api/tests/test_fake_media_package.py::test_materialize_stops_before_creating_a_package`
- `FAILED services/api/tests/test_fake_media_package.py::test_existing_package_verification_stops_and_rejects_unexpected_files`
- `FAILED services/api/tests/test_fake_media_package.py::test_private_ffmpeg_seam_terminates_when_stop_is_requested`
- `FAILED services/api/tests/test_fake_media_package.py::test_private_ffmpeg_seam_rejects_a_nonzero_exit`
- `FAILED services/api/tests/test_fake_media_package.py::test_private_constructor_seam_requires_a_locked_toolchain`
- `FAILED services/api/tests/test_fake_timeline_run_api.py::test_sidecar_enqueues_once_without_materializing_media_in_request`
- `FAILED services/api/tests/test_fake_timeline_run_api.py::test_toolchain_drift_is_a_stable_unavailable_error_without_enqueuing`
- `FAILED services/api/tests/test_fake_timeline_run_api.py::test_concurrent_create_requests_converge_on_one_durable_run`
- `FAILED services/api/tests/test_fake_timeline_run_api.py::test_concurrent_distinct_keys_for_one_frozen_input_create_exactly_one_run`
- `FAILED services/api/tests/test_fake_timeline_run_api.py::test_worker_materializes_real_media_and_completes_timeline_with_recovery_receipt`
- `FAILED services/api/tests/test_fake_timeline_run_api.py::test_unaccepted_manifest_is_rejected_without_enqueuing`
- `FAILED services/api/tests/test_fake_timeline_run_api.py::test_worker_claims_only_its_exact_task_kind`
- `FAILED services/api/tests/test_fake_timeline_run_api.py::test_committed_timeline_is_recovered_after_completion_crash`
- `FAILED services/api/tests/test_fake_timeline_run_api.py::test_sidecar_openapi_publishes_typed_run_but_public_openapi_does_not`
- `FAILED services/api/tests/test_fake_timeline_run_api.py::test_deterministic_media_failure_closes_all_run_states`
- `FAILED services/api/tests/test_fake_timeline_run_api.py::test_worker_fails_closed_when_accepted_manifest_changes_after_enqueue`
- `FAILED services/api/tests/test_fake_timeline_run_api.py::test_running_worker_stops_promptly_without_failing_the_leased_task`
- `FAILED services/api/tests/test_generation_failure_cancel.py::test_cancel_during_reservation_wait_never_enters_post_or_consumes_failure_slot`
- `FAILED services/api/tests/test_generation_failure_dispatch.py::test_real_post_and_get_success_then_cache_need_no_new_allowance`
- `FAILED services/api/tests/test_generation_failure_dispatch.py::test_submitted_unknown_survives_new_key_and_restart_without_another_video_post`
- `FAILED services/api/tests/test_generation_failure_dispatch.py::test_two_identical_video_inputs_in_one_film_release_each_known_success`
- `FAILED services/api/tests/test_generation_failure_dispatch.py::test_known_video_success_is_not_reclassified_by_local_export_failure`
- `FAILED services/api/tests/test_generation_failure_dispatch.py::test_known_unverifiable_reference_blocks_before_any_new_image_or_tts[prepared]`
- `FAILED services/api/tests/test_generation_failure_dispatch.py::test_known_unverifiable_reference_blocks_before_any_new_image_or_tts[reference]`
- `FAILED services/api/tests/test_local_media_original_identity.py::test_real_original_changed_with_restored_size_and_mtime_is_not_reused`
- `FAILED services/api/tests/test_native_media_probe_roundtrip.py::test_actual_local_video_probe_persists_and_reads_exact_version`
- `FAILED services/api/tests/test_p3j_references.py::test_service_autoframe_uses_five_refs_and_video_keeps_thirteen[False]`
- `FAILED services/api/tests/test_p3j_references.py::test_service_autoframe_uses_five_refs_and_video_keeps_thirteen[True]`
- `FAILED services/api/tests/test_prepared_generation_producer.py::test_actual_tts_send_adopts_existing_parent_once_and_new_auto_image_does_not_open_bucket`
- `FAILED services/api/tests/test_prepared_generation_rejections.py::test_readable_silent_local_fallback_does_not_settle_unknown_or_publish_a_video_cache`
- `FAILED services/api/tests/test_prepared_generation_rejections.py::test_actual_signed_consumer_refuses_late_invalid_arm_state_at_zero_transport[unready]`
- `FAILED services/api/tests/test_prepared_generation_routes.py::test_signed_register_image_fact_arm_and_actual_create_use_one_parent_and_no_extra_post`
- `FAILED services/api/tests/test_saved_composition_preview.py::test_saved_dialogue_decodes_exact_offset_interval_and_old_script_audio_pins[draft-export]`
- `FAILED services/api/tests/test_saved_composition_preview.py::test_saved_dialogue_decodes_exact_offset_interval_and_old_script_audio_pins[saved-preview-cache]`
- `FAILED services/api/tests/test_saved_composition_preview.py::test_cached_saved_composition_decodes_old_snapshot_with_continuous_bgm`
- `FAILED services/api/tests/test_story_creation_failure_budget.py::test_all_real_outputs_release_parent_before_later_local_assembly_failure`
- `FAILED services/api/tests/test_story_creation_failure_budget.py::test_two_target_parent_keeps_hold_when_later_actual_image_is_unknown`
- `FAILED services/api/tests/test_story_creation_failure_budget.py::test_video_body_binds_this_actual_prepared_frame_and_speech_adaptive_seconds[within-cap-seconds]`
- `FAILED services/api/tests/test_story_creation_failure_budget.py::test_video_body_binds_this_actual_prepared_frame_and_speech_adaptive_seconds[generated-frame-bytes]`
- `FAILED services/api/tests/test_story_dialogue_audio.py::test_ordered_speakers_decode_to_one_wav_and_cache_changes`
- `FAILED services/api/tests/test_story_dialogue_audio.py::test_same_speaker_multiple_lines_still_synthesizes_every_line`
- `FAILED services/api/tests/test_story_dialogue_audio.py::test_cancel_between_lines_stops_synthesis_and_never_returns_partial_audio`
- `FAILED services/api/tests/test_story_dialogue_audio.py::test_member_two_voices_export_full_audio_beyond_requested_duration[grok-imagine-video-1.5-2-5-references0]`
- `FAILED services/api/tests/test_story_dialogue_audio.py::test_member_two_voices_export_full_audio_beyond_requested_duration[grok-imagine-video-12-10-references1]`
- `FAILED services/api/tests/test_story_dialogue_audio.py::test_dialogue_over_video_cap_fails_before_video_submission[grok-imagine-video-1.5-16-references0-15]`
- `FAILED services/api/tests/test_story_dialogue_audio.py::test_dialogue_over_video_cap_fails_before_video_submission[grok-imagine-video-11-references1-10]`
- `FAILED services/api/tests/test_story_dialogue_audio.py::test_normalize_refuses_long_hold_without_trimming_speech`
- `FAILED services/api/tests/test_story_dialogue_audio.py::test_one_second_hold_budget_preserves_audio_and_never_adds_long_silence`
- `FAILED services/api/tests/test_story_dialogue_audio.py::test_old_short_cached_video_refuses_without_submitting_again`
- `FAILED services/api/tests/test_story_dialogue_limit_evidence.py::test_produce_keeps_typed_facts_from_real_prevideo_audio_check_and_same_key_does_not_call_again`
- `FAILED services/api/tests/test_story_dialogue_limit_evidence.py::test_actual_shot_list_uses_failed_child_index_and_does_not_call_earlier_video_a_batch_zero`
- `FAILED services/api/tests/test_story_dialogue_limit_evidence.py::test_cached_bundle_limit_is_pre_target_video_in_this_request_and_keeps_raw_bytes`
- `FAILED services/api/tests/test_story_film.py::test_stub_pipeline_writes_a_playable_mp4_with_picture_and_sound`
- `FAILED services/api/tests/test_story_film.py::test_missing_font_saves_srt_and_still_makes_the_film`
- `FAILED services/api/tests/test_story_film.py::test_story_film_route_explains_the_provider_before_any_call`
- `FAILED services/api/tests/test_story_film.py::test_subscription_hands_a_b64_image_to_video_and_logs_status_only`
- `FAILED services/api/tests/test_story_film.py::test_subscription_keeps_the_image_and_voice_when_video_fails`
- `FAILED services/api/tests/test_story_film.py::test_normalize_keeps_portrait_widescreen_and_square`
- `FAILED services/api/tests/test_story_film.py::test_mp3_named_as_wav_is_trimmed_to_the_longer_voice`
- `FAILED services/api/tests/test_story_film.py::test_quiet_narration_is_lifted_and_not_cut_off`
- `FAILED services/api/tests/test_story_film.py::test_two_shots_hold_a_character_still_and_join`
- `FAILED services/api/tests/test_story_film.py::test_each_shot_generates_its_own_still_and_mutes_video_audio`
- `FAILED services/api/tests/test_story_film.py::test_real_media_edges_name_the_stage_and_keep_even_canvases`
- `FAILED services/api/tests/test_story_film.py::test_too_short_chosen_length_fails_instead_of_cutting_narration`
- `FAILED services/api/tests/test_story_film.py::test_saved_media_urls_reach_the_video_request`
- `FAILED services/api/tests/test_story_film.py::test_film_is_kept_and_says_why_its_clean_copy_is_missing`
- `FAILED services/api/tests/test_story_film.py::test_film_with_a_clean_copy_reports_no_clean_copy_error`
- `FAILED services/api/tests/test_story_film.py::test_remakes_the_clean_copy_of_a_film_without_calling_a_provider`
- `FAILED services/api/tests/test_story_film.py::test_remake_reports_why_the_clean_copy_failed_again`
- `FAILED services/api/tests/test_story_film.py::test_remake_route_returns_the_clean_copy`
- `FAILED services/api/tests/test_story_film.py::test_clean_recovery_requires_exact_requested_owner_sha_and_assembly`
- `FAILED services/api/tests/test_story_film.py::test_clean_copy_route_rejects_another_project_even_with_the_original_path`
- `FAILED services/api/tests/test_story_film_qc_evidence.py::test_final_clean_copy_evidence_keeps_original_draft_hash_and_is_readable_by_node`
- `FAILED services/api/tests/test_story_film_qc_evidence.py::test_clean_copy_evidence_write_failure_is_not_reported_as_a_usable_copy`
- `FAILED services/api/tests/test_story_speech_window.py::test_padding_over_cap_keeps_raw_voice_and_retry_does_not_submit_video_or_tts[grok-imagine-video-1.5-lite-references1-15]`
- `FAILED services/api/tests/test_story_speech_window.py::test_padding_over_cap_keeps_raw_voice_and_retry_does_not_submit_video_or_tts[grok-imagine-video-references2-10]`
- `FAILED services/api/tests/test_story_speech_window.py::test_production_window_is_applied_once_and_proof_uses_final_derived_audio[False]`
- `FAILED services/api/tests/test_story_speech_window.py::test_production_window_is_applied_once_and_proof_uses_final_derived_audio[True]`
- `FAILED services/api/tests/test_story_speech_window.py::test_exact_cap_auto_duration_and_raw_cache_reuse_never_add_another_video[grok-imagine-video-1.5-references0-15]`
- `FAILED services/api/tests/test_story_speech_window.py::test_exact_cap_auto_duration_and_raw_cache_reuse_never_add_another_video[grok-imagine-video-references1-10]`
- `FAILED services/api/tests/test_story_speech_window.py::test_empty_spoken_text_has_no_synthetic_window_or_policy[False]`
- `FAILED services/api/tests/test_story_speech_window.py::test_empty_spoken_text_has_no_synthetic_window_or_policy[True]`
- `FAILED services/api/tests/test_story_speech_window.py::test_two_shots_auto_extend_independently_keep_second_body_and_actual_layout`
- `FAILED services/api/tests/test_story_speech_window.py::test_actual_long_provider_response_respects_effective_cap_in_production[2-grok-imagine-video-10-references0]`
- `FAILED services/api/tests/test_story_speech_window.py::test_actual_long_provider_response_respects_effective_cap_in_production[2-grok-imagine-video-1.5-15-references1]`
- `FAILED services/api/tests/test_story_speech_window.py::test_actual_long_provider_response_respects_effective_cap_in_production[0.125-grok-imagine-video-10-references0]`
- `FAILED services/api/tests/test_story_speech_window.py::test_actual_long_provider_response_respects_effective_cap_in_production[0.125-grok-imagine-video-1.5-15-references1]`
- `FAILED services/api/tests/test_video_recovery.py::test_original_producer_persists_accepted_id_and_later_recovery_never_resubmits`
- `FAILED services/api/tests/test_workspace_backup_draft.py::test_actual_completed_draft_workspace_backup_and_restore`
- `FAILED services/api/tests/test_xai_media_e2e.py::test_url_image_is_saved_and_handed_to_video_tts_and_compose`
- `FAILED services/api/tests/test_xai_media_e2e.py::test_b64_json_image_is_a_data_uri_and_tts_returns_audio`
- `FAILED services/api/tests/test_xai_media_e2e.py::test_image_cdn_forbidden_is_unverifiable_and_never_submits_video`
- `FAILED services/api/tests/test_xai_media_e2e.py::test_broken_clip_names_the_ffmpeg_exit_and_retries_without_xai`
- `FAILED services/api/tests/test_xai_media_e2e.py::test_old_short_response_is_rejected_without_cutting_raw_voice_or_repeating_upstream`
- `ERROR services/api/tests/test_audio_library_resource_collection.py::test_audio_collection_uses_the_same_actual_runtime_and_public_evidence[packaging/windows/freeze-sidecar.py-packaged]`
- `ERROR services/api/tests/test_audio_library_resource_collection.py::test_audio_collection_uses_the_same_actual_runtime_and_public_evidence[packaging/linux/package-desktop.py-portable]`
- `ERROR services/api/tests/test_audio_library_resource_collection.py::test_audio_collection_uses_the_same_actual_runtime_and_public_evidence[scripts/package-native-linux-checkpoint.py-portable]`
- `ERROR services/api/tests/test_audio_library_resource_collection.py::test_audio_collection_uses_the_same_actual_runtime_and_public_evidence[None-development]`
- `ERROR services/api/tests/test_draft_export_encoder.py::test_real_image_order_and_native_sample_bgm_sfx_mix`
- `ERROR services/api/tests/test_draft_export_encoder.py::test_real_video_frame_trim_and_embedded_play`
- `ERROR services/api/tests/test_draft_export_encoder.py::test_real_still_without_audio`
- `ERROR services/api/tests/test_draft_export_encoder.py::test_rejects_unsupported_and_changed_sources`
- `ERROR services/api/tests/test_draft_export_encoder.py::test_rejects_legacy_bound_subtitles`
- `ERROR services/api/tests/test_draft_export_encoder.py::test_rejects_video_range_and_rate`
- `ERROR services/api/tests/test_draft_export_encoder.py::test_cancel_and_binary_pin_fail_closed`
- `ERROR services/api/tests/test_draft_export_encoder.py::test_cancellation_during_encode`
- `ERROR services/api/tests/test_draft_export_encoder.py::test_ntsc_frame_boundaries_and_nonstandard_native_audio_rate`
- `ERROR services/api/tests/test_draft_export_encoder.py::test_source_audio_range_and_existing_output_rejected[BGM]`
- `ERROR services/api/tests/test_draft_export_encoder.py::test_source_audio_range_and_existing_output_rejected[SFX]`
- `ERROR services/api/tests/test_draft_export_encoder.py::test_source_audio_range_and_existing_output_rejected[DIALOGUE]`
- `ERROR services/api/tests/test_draft_export_encoder.py::test_canvas_segment_and_duration_bounds`
- `ERROR services/api/tests/test_draft_export_encoder.py::test_rejects_vfr_even_when_a_requested_range_would_fit`
- `ERROR services/api/tests/test_draft_export_encoder.py::test_linux_cancellation_reaps_exact_encoder_process_group`
- `ERROR services/api/tests/test_draft_export_encoder.py::test_animation_extension_cannot_be_silently_flattened`
- `ERROR services/api/tests/test_draft_review_notes.py::test_reopen_exact_frame_identity_idempotency_and_resolve_no_release`
- `ERROR services/api/tests/test_draft_review_notes.py::test_new_assembly_and_new_output_preserve_older_notes`
- `ERROR services/api/tests/test_draft_review_notes.py::test_rejects_forged_target_and_out_of_range_frame[change0]`
- `ERROR services/api/tests/test_draft_review_notes.py::test_scope_duplicate_id_conflicts_and_resolution_identity`
- `ERROR services/api/tests/test_draft_review_notes.py::test_missing_output_retains_history_blocks_new_notes_and_allows_original_resolution`
- `ERROR services/api/tests/test_draft_review_notes.py::test_corrupt_note_readback_fails_closed`
- `ERROR services/api/tests/test_draft_review_notes.py::test_native_routes_auth_closed_input_and_readback`
- `ERROR services/api/tests/test_draft_review_revision.py::test_complete_manual_lifecycle_and_preserved_history`
- `ERROR services/api/tests/test_draft_review_revision.py::test_approval_is_distinct_and_preexisting_candidate_rejected`
- `ERROR services/api/tests/test_draft_review_revision.py::test_closed_bounded_commands[changes0]`
- `ERROR services/api/tests/test_draft_review_revision.py::test_closed_bounded_commands[changes1]`
- `ERROR services/api/tests/test_draft_review_revision.py::test_closed_bounded_commands[changes2]`
- `ERROR services/api/tests/test_draft_review_revision.py::test_closed_bounded_commands[changes4]`
- `ERROR services/api/tests/test_draft_review_revision.py::test_closed_bounded_commands[changes5]`
- `ERROR services/api/tests/test_draft_review_revision.py::test_closed_bounded_commands[changes8]`
- `ERROR services/api/tests/test_draft_review_revision.py::test_wrong_scope_selections_hash_and_reused_ids`
- `ERROR services/api/tests/test_draft_review_revision.py::test_parallel_identical_create_one_event`
- `ERROR services/api/tests/test_draft_review_revision.py::test_immutable_triggers_and_corruption_rejected`
- `ERROR services/api/tests/test_draft_review_revision.py::test_saved_export_proof_corruption_fails_closed_without_job_writes[wrong-frames]`
- `ERROR services/api/tests/test_draft_review_revision.py::test_saved_export_proof_corruption_fails_closed_without_job_writes[incomplete]`
- `ERROR services/api/tests/test_draft_review_revision.py::test_candidate_scope_corruption_fails_closed`
- `ERROR services/api/tests/test_draft_review_revision.py::test_native_revision_routes_auth_closed_commands_and_durable_readback`
- `ERROR services/api/tests/test_draft_review_revision.py::test_note_must_lie_in_selected_original_segment`
- `ERROR services/api/tests/test_draft_review_revision.py::test_history_size_budget_rejects_before_commit`
- `ERROR services/api/tests/test_draft_subtitles.py::test_actual_pixels_on_exact_half_open_frames[rate0]`
- `ERROR services/api/tests/test_draft_subtitles.py::test_actual_pixels_on_exact_half_open_frames[rate1]`
- `ERROR services/api/tests/test_draft_subtitles.py::test_actual_pixels_on_exact_half_open_frames[rate2]`
- `ERROR services/api/tests/test_draft_subtitles.py::test_drawtext_keeps_a_colon_inside_the_font_path`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_cache_only_actual_storyfilm_consumes_saved_video_without_provider_or_policy`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_late_cache_product_loss_never_falls_back_to_new_post[missing]`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_late_cache_product_loss_never_falls_back_to_new_post[same-size]`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_late_cache_product_loss_never_falls_back_to_new_post[symlink]`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_preparation_cannot_rebind_original_intent_or_first_slot[body]`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_fresh_later_slot_cannot_arm_cache_body_or_claim_cached_slot`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_late_loss_after_real_arm_is_blocked_before_any_provider_send[product]`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_late_loss_after_real_arm_is_blocked_before_any_provider_send[intent-source]`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_shared_image_hold_skips_cache_zero_and_cannot_relabel_after_dispatch`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_cache_freeze_obeys_original_execution_account_retirement_and_dispatch_gate[account]`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_cache_freeze_obeys_original_execution_account_retirement_and_dispatch_gate[retired]`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_cache_freeze_obeys_original_execution_account_retirement_and_dispatch_gate[started]`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_cache_read_does_not_settle_unknown_or_unlock_it_with_new_limit_or_execution`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_reread_rejects_changed_source_bytes_canonical_and_mime`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_lineage_does_not_cross_account_or_project`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_image_or_arm_before_freeze_leaves_no_table_and_freeze_skips_cache_quota`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_freeze_before_image_dispatch_holds_only_client_slots`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_concurrent_prepare_and_image_dispatch_never_hold_a_cached_slot`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_concurrent_prepares_publish_one_identical_table`
- `ERROR services/api/tests/test_video_recovery.py::test_restart_recovers_only_get_and_releases_only_after_full_readable_video`
- `ERROR services/api/tests/test_video_recovery.py::test_active_original_poll_and_parallel_recovery_share_real_lock`
- `ERROR services/api/tests/test_video_recovery.py::test_original_input_binding_and_modified_recovered_bytes_are_not_reauthorized`
- `ERROR services/api/tests/test_video_recovery_routes.py::test_signed_actual_route_list_recover_then_explicit_read_preserves_bytes`

### `builder-typescript-missing`（4）

四条是同一个 module fixture。直接重跑脚本的 stderr 是 `ERR_MODULE_NOT_FOUND: Cannot find package 'typescript'`。不是横幅问题。本机装上 `typescript@5.9.3` 后脚本退出码 0，四条测试在干净环境通过。node_modules 不入库。

- `FAILED services/api/tests/test_assembly_script_provenance.py::test_authority_change_after_admission_stops_worker_before_encoder`
- `FAILED services/api/tests/test_assembly_script_provenance.py::test_confirmation_during_encode_cannot_publish_stale_output`
- `FAILED services/api/tests/test_assembly_storyboard_provenance.py::test_linked_assembly_still_exports_real_draft_after_storyboard_head_changes`
- `FAILED services/api/tests/test_audio_asset_probe.py::test_actual_linux_wav_probes_source_samples_and_fails_new_probe_after_file_change`

### `child-exit-1-not-73`（3）

子进程在 `os._exit(73)` 之前失败。干净环境复跑的子进程 stderr 是 `libvpx-vp9` ABI mismatch：锁定的 Debian ffmpeg 7.1.5 加载了 Ubuntu 的 `libvpx.so.9`。把 `libvpx.so.9` 和 `libopus.so.0` 换成 trixie 对应库后，代表用例通过。

- `FAILED services/api/tests/test_story_pcm_silence.py::test_observed_full_scale_loudnorm_fault_is_avoided_only_for_verified_zero[True]`
- `FAILED services/api/tests/test_story_pcm_silence.py::test_short_nonzero_with_no_loudness_measurement_keeps_the_original_spoken_policy`
- `FAILED services/api/tests/test_story_speech_window.py::test_real_normalization_keeps_mandatory_window_and_hold_within_one_second`

### `assert-spawned-processes-not-all-ok`（1）

与 child-exit 同一条 FFmpeg 生成失败。libvpx 对齐后代表用例通过。

- `FAILED services/api/tests/test_story_pcm_silence.py::test_observed_full_scale_loudnorm_fault_is_avoided_only_for_verified_zero[False]`

### `assert-event-wait-timeout`（2）

子进程没有发到约定阶段，`Event.wait(120)` 失败。libvpx 对齐后代表用例通过。

- `FAILED services/api/tests/test_story_speech_window.py::test_new_window_never_shrinks_tail_to_fit_but_legacy_default_is_unchanged`
- `FAILED services/api/tests/test_story_speech_window.py::test_padding_over_cap_keeps_raw_voice_and_retry_does_not_submit_video_or_tts[grok-imagine-video-1.5-references0-15]`

### `assert-draft-toolchain-unavailable`（1）

横幅被拒后的下游 503。干净环境代表用例通过。

- `FAILED services/api/tests/test_story_film.py::test_a_long_clip_is_cut_to_the_chosen_length_and_a_short_one_stays`

### `assert-toolchain-unavailable-vs-dialogue-limit`（3）

工具不可用替代了原来的时长拒绝。干净环境代表用例通过。

- `ERROR services/api/tests/test_prepared_generation_cache.py::test_preparation_cannot_rebind_original_intent_or_first_slot[key]`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_preparation_cannot_rebind_original_intent_or_first_slot[regenerate]`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_preparation_cannot_rebind_original_intent_or_first_slot[source]`

### `assert-local-video-tool-unavailable`（1）

期望停止文案，实际是视频工具不可用。干净环境代表用例通过。

- `ERROR services/api/tests/test_draft_review_revision.py::test_closed_bounded_commands[changes3]`

### `assert-picture-step-failed`（14）

成片没有做成，文案是画面步骤失败。干净环境代表用例通过。

- `ERROR services/api/tests/test_draft_review_notes.py::test_rejects_forged_target_and_out_of_range_frame[change4]`
- `ERROR services/api/tests/test_draft_review_revision.py::test_junction_scope_corruption_fails_closed`
- `ERROR services/api/tests/test_draft_review_revision.py::test_saved_export_proof_corruption_fails_closed_without_job_writes[invalid-json]`
- `ERROR services/api/tests/test_draft_review_revision.py::test_all_event_retries_survive_missing_bytes_and_reused_ids_conflict`
- `ERROR services/api/tests/test_draft_subtitles.py::test_bundled_font_draws_chinese_without_system_fonts`
- `ERROR services/api/tests/test_draft_subtitles.py::test_runtime_publishes_saved_subtitles_with_font_provenance`
- `ERROR services/api/tests/test_fake_media_package.py::test_public_existing_package_rejects_manifest_integrity_drift[manifest-size-limit]`
- `ERROR services/api/tests/test_fake_media_package.py::test_public_existing_package_rejects_manifest_integrity_drift[manifest-noncanonical]`
- `ERROR services/api/tests/test_fake_media_package.py::test_public_existing_package_rejects_manifest_integrity_drift[manifest-identity-mismatch]`
- `ERROR services/api/tests/test_fake_media_package.py::test_public_existing_package_rejects_png_contract_drift`
- `ERROR services/api/tests/test_fake_media_package.py::test_public_existing_package_rejects_wav_contract_drift`
- `ERROR services/api/tests/test_fake_media_package.py::test_public_existing_package_rejects_preview_contract_drift`
- `ERROR services/api/tests/test_fake_media_package.py::test_staging_verification_seam_rejects_a_noncanonical_lease`
- `ERROR services/api/tests/test_prepared_generation_cache.py::test_real_signed_mixed_slots_freeze_cache_zero_and_fresh_later_slots`

### `assert-failed-vs-succeeded`（2）

期望成功，实际失败。干净环境代表用例通过。

- `ERROR services/api/tests/test_draft_review_notes.py::test_rejects_forged_target_and_out_of_range_frame[change2]`
- `ERROR services/api/tests/test_draft_review_revision.py::test_saved_export_proof_corruption_fails_closed_without_job_writes[wrong-hash]`

### `assert-film-failed-vs-creation-input-unverifiable`（1）

错误码被工具失败盖住。干净环境代表用例通过。

- `ERROR services/api/tests/test_draft_review_notes.py::test_rejects_forged_target_and_out_of_range_frame[change3]`

### `typeerror-nonetype-subscript`（5）

上游媒体结果是 None 之后再取值。干净环境代表用例通过。

- `ERROR services/api/tests/test_draft_export_encoder.py::test_output_tampering_after_encode_never_returns_receipt`
- `ERROR services/api/tests/test_draft_export_encoder.py::test_ffmpeg_pin_checked_after_probing_and_before_encode`
- `ERROR services/api/tests/test_draft_review_revision.py::test_closed_bounded_commands[changes6]`
- `ERROR services/api/tests/test_draft_review_revision.py::test_closed_bounded_commands[changes7]`
- `ERROR services/api/tests/test_draft_review_revision.py::test_missing_bytes_preserve_history_and_fail_closed`

### `assert-empty-request-list`（2）

期望有一次请求，列表为空。干净环境里 `test_readback_waits_for_timed_out_submission_before_definite_absence` 通过。

- `FAILED services/api/tests/test_story_film.py::test_remake_finds_only_films_this_workspace_made`
- `ERROR services/api/tests/test_draft_review_notes.py::test_rejects_forged_target_and_out_of_range_frame[change1]`

### `assert-none-is-not-none`（1）

缓存时长检查没有拿到对象。干净环境代表用例通过。

- `ERROR services/api/tests/test_draft_review_revision.py::test_output_changes_between_read_and_mutation_gate`

### `assert-verified-vs-unknown-media-changed`（1）

同环境对照见下方「原件身份对照」。无 diff 不是免责。快速覆写时 ctime 没有被改回，它根本没有前进，缓存仍返回 VERIFIED。这是继承的未关闭原完整性门。产品代码本片没有改。

- `FAILED services/api/tests/test_local_media_original_identity.py::test_real_original_changed_with_restored_size_and_mtime_is_not_reused`

此前列在这里的 `test_draft_export_encoder.py::test_safe_process_arguments_and_probe_output_bound` 是夹具设置时的 ncurses 横幅，不是这条断言。

## 环境修复

没有改解析器，也没有改锁文件。

- 运行中的 tmux server 执行了 `tmux set-environment -g -u LD_LIBRARY_PATH`。`~/.bashrc` 和 `~/.profile` 会去掉 `/exec-daemon/tmux-root/lib`，避免新的登录 shell 再把 ncurses 警告写进 `ffmpeg -version` 首行。
- `/usr/lib/x86_64-linux-gnu/libvpx.so.9` 和 `libopus.so.0` 改为 trixie 的 `libvpx.so.9.1.0`、`libopus.so.0.10.1`。Ubuntu 原文件留在 `/tmp/ubuntu-lib-backup`。这是为了让已锁定的 Debian ffmpeg 7.1.5 二进制能加载匹配的 ABI。
- 工作区 `node_modules` 安装了 `typescript@5.9.3`，只为音频构建脚本的 import。未改 `package.json`，`node_modules` 不入库。

## 干净环境复跑

候选 SHA `1227af513b72cf20cb9d054bcb6a2aba1f5338d0`。`LD_LIBRARY_PATH` 未设置。`ffmpeg -version` 首行是 `ffmpeg version 7.1.5-0+deb13u1`。没有重跑 5453 项全套。

第一轮代表用例在 libvpx 仍是 Ubuntu ABI 时：`4 failed, 23 passed in 158.69s`。失败是 child-exit、两个 spawn、lease wait、以及 VERIFIED 身份测试。builder 四条、横幅代表、以及其余工具下游代表已通过。

对齐 libvpx/libopus 后只复跑仍失败的四条：`1 failed, 3 passed in 27.60s`。三条 FFmpeg 生成用例通过。仍失败的是 `test_real_original_changed_with_restored_size_and_mtime_is_not_reused`。

`local_media_original.py` 相对 `6bb54bb` 没有 diff。这只说明两边源码相同，不能代替下面的两次 pytest。失败原因不是 ctime 被 `utime` 改回。

## 缓存目标测试数量

两组数字分开，不相加，也不当成新的全库数字。

旧的 57 项，发生在新增并发/重读用例之前，tmux 外，Debian ffmpeg 库已在默认路径：

```
uv run pytest -q --tb=line services/api/tests/test_prepared_generation_cache.py services/api/tests/test_prepared_generation_cache_guards.py services/api/tests/test_desktop_subscription_dispatch.py::test_grok_and_chatgpt_logins_record_subscription_without_a_money_hold services/api/tests/test_dispatch_billing.py::test_billing_records_are_immutable_and_migration_49_is_additive services/api/tests/test_media_budget_reservation.py::test_migration_48_adds_the_budget_ledger_without_rewriting_projects services/api/tests/test_project_aspect_ratios.py::test_existing_stored_landscape_gets_do_not_migrate_or_rewrite_any_db_bytes services/api/tests/test_story_creation_failure_budget.py::test_additive_53_preserves_all_52_sql_rows_and_creates_no_allowance services/api/tests/test_video_recovery.py::test_migration_52_preserves_existing_policy_attempt_rows_and_old_table_sql
```

结果：`57 passed in 31.24s`。

新增后的单独命令，只含 6 个新用例和已扩展的 UNKNOWN 用例，候选仍是 `1227af51`：

```
uv run pytest -q --tb=line services/api/tests/test_prepared_generation_cache.py::test_reread_rejects_changed_source_bytes_canonical_and_mime services/api/tests/test_prepared_generation_cache.py::test_lineage_does_not_cross_account_or_project services/api/tests/test_prepared_generation_cache.py::test_image_or_arm_before_freeze_leaves_no_table_and_freeze_skips_cache_quota services/api/tests/test_prepared_generation_cache.py::test_freeze_before_image_dispatch_holds_only_client_slots services/api/tests/test_prepared_generation_cache.py::test_concurrent_prepare_and_image_dispatch_never_hold_a_cached_slot services/api/tests/test_prepared_generation_cache.py::test_concurrent_prepares_publish_one_identical_table services/api/tests/test_prepared_generation_cache.py::test_cache_read_does_not_settle_unknown_or_unlock_it_with_new_limit_or_execution
```

结果：`7 passed in 20.15s`。

`ruff` 与 `mypy`、合同生成沿用上一轮结果，这次没有重跑。没有接 main，没有新功能。

## 原件身份对照（2026-11-10 01:01 UTC）

只跑 `test_real_original_changed_with_restored_size_and_mtime_is_not_reused` 各一次。同一云环境，`LD_LIBRARY_PATH` 未设置，锁定的 `/usr/bin/ffmpeg` 首行是 `ffmpeg version 7.1.5-0+deb13u1`。该测试本身不调用 ffmpeg。工作区 pytest 会把 `pythonpath` 指到 `/workspace`，所以两次都在对应 worktree 里用 `/workspace/.venv/bin/pytest`，并 `--override-ini addopts=`。没有改断言、锁或超时。没有重跑 5453 项全套。

| 对照 | SHA | 结果 |
| --- | --- | --- |
| handoff 基线 | `6bb54bbcce5e4051454a9fa0a17ab4dd72472167` | `1 failed in 0.56s`。`assert 'VERIFIED' == 'UNKNOWN_MEDIA_CHANGED'` |
| 代码候选 | `1227af513b72cf20cb9d054bcb6a2aba1f5338d0` | `1 failed in 0.44s`。同一断言 |

`local_media_original.py` 两边 `diff` 退出码 0。这只记录源码相同。基线同样失败，所以这是继承的未关闭原完整性门，不是本批 API55 新引入后被无 diff 放过。

候选模块按测试同一顺序实测。文件系统是 `ext4 /dev/vdc rw,relatime`。

| 时点 | dev | ino | size | mtime_ns | ctime_ns | SHA256 |
| --- | --- | --- | --- | --- | --- | --- |
| 创建 `b"owned bounded original"` | 65056 | 772118 | 22 | 1794272263957547757 | 1794272263957547757 | `5bfb616357df8c4a0222dacfe5e891dced7bddacbfdbe96a14ede06186996a37` |
| 第一次核验后 | 65056 | 772118 | 22 | 1794272263957547757 | 1794272263957547757 | 同上 |
| 覆写为 22 个 `x` 后 | 65056 | 772118 | 22 | 1794272263957547757 | 1794272263957547757 | `ec4a4fcd915a7672085936bb477cc50561660015653ad41616c8419727e97ff1` |
| `os.utime(ns=(原 atime, 原 mtime))` 后 | 65056 | 772118 | 22 | 1794272263957547757 | 1794272263957547757 | 同上 |

覆写前后 SHA 不同，字节确实变了。第一次返回 `VERIFIED`，`used_bytes` 为 22，identity cache 写入 `(dev, ino, size, mtime_ns, ctime_ns)`。覆写并调用 `utime` 之后，缓存的 named identity 与 held identity 都等于当前 identity。第二次仍返回 `VERIFIED`，`used_bytes` 仍是 22，没有再次哈希。这是可触发的陈旧核验复用，不是读错了 ctime。`utime` 在这条快速路径上是空操作，因为时间戳从未变化。

同一卷上，`statx` 请求掩码 `0x7fff`、返回掩码 `0x6fff`，快速覆写前后 256 字节 statx 缓冲区没有差异。`FS_IOC_GETVERSION` 读到的是创建代际，覆写后也不变。没有可用的元数据字段能区分这两份载荷。

正向对照仍用候选模块，覆写前先 `sleep(0.02)`。写入把 ctime 从 `1794272451648381309` 改到 `1794272451672381714`。随后的 `utime` 只把 mtime 设回原值，ctime 保持新值。第二次返回 `UNKNOWN_MEDIA_CHANGED`，文件 SHA 仍是覆写后的 `ec4a4fcd...`。文件系统真正更新 ctime 时，现有检查会拒绝缓存。失败的 pytest 没有等待，覆写落在同一次时间戳采样里。

缓存命中路径补做一次完整哈希、不第二次计入 `used_bytes`、哈希不符时返回 `UNKNOWN_MEDIA_CHANGED` 的试验，能使身份文件里 7 个测试通过，包括这条目标测试。它同时打破未改的单次哈希预算断言：

- `test_recursive_duplicate_originals_hash_once_and_independent_request_resets`：实际 552 与 414，期望各 138
- `test_recursive_candidate_and_g5_originals_share_direct_read_allowance[False]`：实际 138，期望 69
- `test_recursive_candidate_and_g5_originals_share_direct_read_allowance[True]`：实际 207，期望 69

未打补丁时，hash-once 测试函数体内对两个摘要分别调用 `_availability` 14 次和 9 次；两次 inspect 合计，每个摘要的物理读取仍是两倍文件大小，也就是每个 inspect 一次。缓存命中补读会把这份读取放大。断言、锁和超时都没有改。试验已撤回，`local_media_original.py` 再次与 `6bb54bb` 相同。没有改 desktop 共享文件。

因此本片不落地产品修改。原件核验在时间戳不动时仍会信任同 size/mtime/ctime 的缓存。这道门保持未关闭。完整 Python 门仍是 `143 failed / 5204 passed / 6 skipped / 100 errors`，退出码 1。最终集成候选必须重跑那道门。本批未验收。
