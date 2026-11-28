#!/usr/bin/env bash
set -euo pipefail

directory="$RUNNER_TEMP/f1-news-model"
model="$directory/qwen3-4b-instruct.gguf"
engine="$directory/llama-b6800"
model_sha=85e4a5b7b8ef0e48af0e8658f5aaab9c2324c76c1641493f4d1e25fce54b18b9
engine_sha=1acbf4a98ef27642f09b121def84144dde77b773f1dd6bfd6f131a370c81f7cf

prepare() {
  mkdir -p "$directory" || return
  if [ ! -s "$model" ]; then
    curl -fsSL --retry 2 --max-time 420 -o "$model.partial" \
      "https://registry.ollama.ai/v2/library/qwen3/blobs/sha256:$model_sha" || return
    echo "$model_sha  $model.partial" | sha256sum -c --status || return
    mv "$model.partial" "$model" || return
  fi
  if [ ! -d "$engine" ]; then
    curl -fsSL --retry 2 --max-time 90 -o "$directory/llama.zip" \
      https://github.com/ggml-org/llama.cpp/releases/download/b6800/llama-b6800-bin-ubuntu-x64.zip || return
    echo "$engine_sha  $directory/llama.zip" | sha256sum -c --status || return
    unzip -q "$directory/llama.zip" -d "$engine" || return
    rm "$directory/llama.zip"
  fi
  binary="$(find "$engine" -type f -name llama-server -print -quit)"
  [ -x "$binary" ]
}

if prepare; then
  "$binary" --model "$model" --host 127.0.0.1 --port 4187 --ctx-size 12288 --threads 4 --parallel 1 --jinja \
    > "$RUNNER_TEMP/f1-news-model.log" 2>&1 &
  server=$!
  trap 'kill "$server" 2>/dev/null || true' EXIT
  for attempt in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:4187/health >/dev/null 2>&1; then
      export F1_NEWS_MODEL=http://127.0.0.1:4187
      break
    fi
    if ! kill -0 "$server" 2>/dev/null; then break; fi
    sleep 1
  done
fi

if [ -z "${F1_NEWS_MODEL:-}" ]; then
  echo "::warning::News model unavailable. Previously published full articles remain available."
  if [ -f "$RUNNER_TEMP/f1-news-model.log" ]; then tail -20 "$RUNNER_TEMP/f1-news-model.log"; fi
fi
node scripts/build-live.mjs
