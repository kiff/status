#!/usr/bin/env bash
# What must never be in this public repo or on the page it builds: run on
# every push (CI) and before publishing. Each line is a label and an
# extended regex; any match fails. public/ is checked too, after a build.
#
#   scripts/public-check.sh [dir]
set -euo pipefail
dir="${1:-.}"

deny=(
	"AWS host|amazonaws\.com|\.on\.aws|lambda-url|cloudfront\.net|elb\.amazonaws"
	"AWS ARN or account id|arn:aws|(^|[^0-9])[0-9]{12}([^0-9]|$)"
	"AWS region|\b(us|eu|ap|sa|ca|me|af)-(east|west|north|south|central|northeast|southeast)-[0-9]\b"
	"IP address|\b[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\b"
	"internal hostname|[a-z0-9-]+\.(internal|local|lan|corp)\b|ip-[0-9]+-[0-9]+-[0-9]+-[0-9]+"
	"private key|BEGIN [A-Z ]*PRIVATE KEY"
	"token or key|(sk|pk|rk|whsec)_(live|test)_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[abp]-[A-Za-z0-9-]+"
	"Vercel id|\b(prj|team)_[A-Za-z0-9]{16,}"
	"kiff hostname beyond the public ones|[a-z0-9.-]+\.kiff\.dev"
	"email address|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}"
)
# Public names that match the patterns above, as whole matches.
allow='(api|mcp|planque|status)\.kiff\.dev|6571984\+gabosarmiento@users\.noreply\.github\.com|41898282\+github-actions\[bot\]@users\.noreply\.github\.com'

failed=0
for rule in "${deny[@]}"; do
	label="${rule%%|*}"
	re="${rule#*|}"
	hits="$(cd "$dir" && grep -rnoIE --exclude-dir=.git --exclude-dir=node_modules --exclude=public-check.sh "$re" . | grep -vE "^[^:]+:[0-9]+:($allow)$" || true)"
	if [[ -n "$hits" ]]; then
		echo "-- $label"
		echo "$hits"
		failed=1
	fi
done
[[ $failed -eq 0 ]] && echo "public check passed on $dir" || { echo "public check FAILED" >&2; exit 1; }
