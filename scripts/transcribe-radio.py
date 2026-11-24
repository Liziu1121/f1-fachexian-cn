"""Transcribe published F1 radio recordings with a multilingual Whisper model."""
import hashlib
import io
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from faster_whisper import WhisperModel

MODEL_REVISION = "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66"
MODEL_ROOT = f"https://huggingface.co/Systran/faster-whisper-base/resolve/{MODEL_REVISION}/"
MODEL_FILES = {"config.json": 2309, "model.bin": 145217532, "tokenizer.json": 2203239, "vocabulary.txt": 459861}
MODEL_SHA256 = "d01c3014881c9c6f3133c182f3d2887eb6ca1c789a7538c5c007196857a0a6a9"


def model_directory(models):
    directory = models / MODEL_REVISION
    directory.mkdir(parents=True, exist_ok=True)
    for name, size in MODEL_FILES.items():
        path = directory / name
        if path.is_file() and path.stat().st_size == size:
            continue
        temporary = path.with_suffix(".part")
        digest = hashlib.sha256()
        request = Request(MODEL_ROOT + name + "?download=true", headers={"User-Agent": "F1-Radio-Archive/1.0"})
        with urlopen(request, timeout=35) as response, temporary.open("wb") as target:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                target.write(chunk)
                digest.update(chunk)
        if temporary.stat().st_size != size or (name == "model.bin" and digest.hexdigest() != MODEL_SHA256):
            temporary.unlink()
            raise ValueError(f"Invalid Whisper model file: {name}")
        temporary.replace(path)
    return directory


queue, output, models = map(Path, sys.argv[1:])
model = WhisperModel(str(model_directory(models)), device="cpu", compute_type="int8", cpu_threads=2, local_files_only=True)
with output.open("w", encoding="utf-8", buffering=1) as results:
    for clip in json.loads(queue.read_text(encoding="utf-8")):
        url = urlsplit(clip["url"])
        if url.scheme != "https" or url.hostname not in {"livetiming.formula1.com", "f1archive.org"}:
            continue
        entry = {"url": clip["key"], "source": clip["url"]}
        try:
            with urlopen(Request(clip["url"], headers={"User-Agent": "F1-Radio-Archive/1.0"}), timeout=8) as response:
                final = urlsplit(response.geturl())
                if final.scheme != "https" or final.hostname not in {"livetiming.formula1.com", "f1archive.org"}:
                    continue
                audio = response.read(2_000_001)
                if not audio or len(audio) > 2_000_000:
                    continue
            segments, info = model.transcribe(io.BytesIO(audio), vad_filter=True, beam_size=3,
                                              condition_on_previous_text=False)
            text = " ".join(segment.text.strip() for segment in segments if segment.no_speech_prob < .7).strip()
            if text and info.language_probability >= .4:
                entry.update(text=text, language=info.language)
        except (OSError, ValueError, RuntimeError) as error:
            print(f"Radio transcription skipped: {error}", file=sys.stderr)
        finally:
            results.write(json.dumps(entry, ensure_ascii=False) + "\n")
