#!/usr/bin/env bash
set -euo pipefail

# Docker named volumes are initially owned by root. Repair the configured cache
# roots and stale job directories before starting as the unprivileged user;
# cached multi-gigabyte payload files never need an ownership rewrite.
if [ "$(id -u)" -eq 0 ]; then
  cache_root="${CACHE_DIR:-/app/.cache}"
  volume_cache_root="${VOLUME_CACHE_DIR:-${cache_root}/volume-files}"
  pt3_volume_stack_root="${cache_root}/pt3_volume_stacks"
  pt3_splat_asset_root="${cache_root}/pt3_splat_assets"
  pt3_real_splat_asset_root="${cache_root}/pt3_real_splat_assets"

  prepare_private_cache_directory() {
    cache_path="$1"
    if [ -L "$cache_path" ]; then
      echo "Refusing symbolic-link cache directory: $cache_path" >&2
      exit 1
    fi
    if [ -e "$cache_path" ] && [ ! -d "$cache_path" ]; then
      echo "Refusing non-directory cache path: $cache_path" >&2
      exit 1
    fi
    mkdir -p -- "$cache_path"
    # Recheck after creation so ownership and mode changes never deliberately
    # follow a pre-existing cache symlink during privileged startup.
    if [ -L "$cache_path" ] || [ ! -d "$cache_path" ]; then
      echo "Cache path became unsafe during startup: $cache_path" >&2
      exit 1
    fi
    chown --no-dereference appuser:appuser "$cache_path"
    chmod 0700 "$cache_path"
  }

  prepare_private_cache_directory "$cache_root"
  prepare_private_cache_directory "$volume_cache_root"
  prepare_private_cache_directory "$pt3_volume_stack_root"
  prepare_private_cache_directory "$pt3_splat_asset_root"
  prepare_private_cache_directory "$pt3_real_splat_asset_root"

  # Repair stale root-created job directories without walking or rewriting
  # multi-gigabyte cached payload files.
  find -P \
    "$pt3_volume_stack_root" \
    "$pt3_splat_asset_root" \
    "$pt3_real_splat_asset_root" \
    -xdev -type d \
    -exec chown --no-dereference appuser:appuser {} + \
    -exec chmod 0700 {} +
  exec runuser -u appuser -- bash "$0"
fi

cd /app/backend
echo 'Running database migrations...'
python /app/backend/scripts/run_migrations.py
echo 'Starting backend server with hot reload...'
exec uvicorn main:app --host 0.0.0.0 --port 8000 --reload
