"""Transcribe published F1 radio recordings with a multilingual Whisper model."""
import io
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from faster_whisper import WhisperModel

queue, output, models = map(Path, sys.argv[1:])
model = WhisperModel("base", device="cpu", compute_type="int8", cpu_threads=2, download_root=str(models))
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
