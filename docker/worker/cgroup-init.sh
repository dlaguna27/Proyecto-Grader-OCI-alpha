#!/bin/sh
# Prepares a delegated cgroup v2 subtree for isolate inside a privileged container.
set -eu
CG=/sys/fs/cgroup
mkdir -p /run/isolate/locks
if [ "${ISOLATE_CGROUPS:-1}" = "1" ]; then
  if [ ! -w "$CG/cgroup.subtree_control" ]; then
    echo "cgroup-init: $CG is not writable; run the worker with 'privileged: true' and cgroup v2" >&2
    exit 1
  fi
  mkdir -p "$CG/init" "$CG/isolate"
  # cgroup v2 forbids processes in a cgroup that delegates controllers to children.
  for pid in $(cat "$CG/cgroup.procs"); do
    echo "$pid" > "$CG/init/cgroup.procs" 2>/dev/null || true
  done
  controllers=""
  for c in cpuset memory pids; do
    grep -qw "$c" "$CG/cgroup.controllers" && controllers="$controllers +$c"
  done
  for c in $controllers; do echo "$c" > "$CG/cgroup.subtree_control"; done
  for c in $controllers; do echo "$c" > "$CG/isolate/cgroup.subtree_control"; done
  echo "cgroup-init: enabled$controllers for isolate" >&2
fi
exec "$@"
