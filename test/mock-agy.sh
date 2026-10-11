#!/usr/bin/env bash
# Mock agy for e2e testing of geminiswitcher.
# Behaviors:
#   mock-agy login        -> prints login success, exits 0 (does not touch keyring)
#   mock-agy -c           -> prints "resumed previous conversation", then REPL
#   mock-agy              -> REPL: echoes input; "trigger429" prints a fake limit error
set -u

if [ "${1:-}" = "login" ]; then
  echo "mock-agy: browser login complete (mock)"
  exit 0
fi

if [ "${1:-}" = "-c" ] || [ "${1:-}" = "--continue" ]; then
  echo "mock-agy: resumed previous conversation"
fi

echo "mock-agy ready"
printf '> '
while IFS= read -r line; do
  case "$line" in
    trigger429)
      echo "ERROR: RESOURCE_EXHAUSTED (429): quota exceeded for model gemini-mock"
      ;;
    quit|exit)
      echo "bye"
      exit 0
      ;;
    *)
      echo "you said: $line"
      ;;
  esac
  printf '> '
done
