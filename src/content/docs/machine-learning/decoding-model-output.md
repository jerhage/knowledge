---
title: "Decoding Model Output: Greedy Loops, CTC and WordPiece"
description: Fake "merged" decoders and `pipeline()`, driving the decoder by hand, CTC collapse order, and WordPiece spacing.
tags: [machine-learning, transformers-js, onnx, ocr]
sidebar:
  order: 4
---

A model's raw output is scores, not text. Decoding is the step that turns those scores into characters, and it's where two of my OCR models went wrong without any error. manga-ocr is an encoder-decoder: the encoder reads the image, and a decoder writes the text one token at a time. A PaddleOCR line recognizer is a single graph whose output is decoded with CTC. Loading the sessions in the first place is in [Loading Hub Models in transformers.js](/machine-learning/loading-hub-models/). The loop and the post-processing below are stages 9 and 10 of the [OCR pipeline](/machine-learning/browser-ocr-pipeline/).

## A file named `decoder_model_merged.onnx` is not necessarily merged

An exported decoder can come as one of two graphs. A plain decoder takes the whole token prefix on every step and computes everything again. A merged decoder can also take a cache of what it computed on earlier steps, so each step only has to feed it the newest token. transformers.js loads an encoder-decoder's decoder from a file named `decoder_model_merged.onnx`.

Every published manga-ocr export, including `kimchireader/manga-ocr-onnx-q8`, the one I made for Dokseo, my manga and book reader, has a file called `decoder_model_merged.onnx` whose graph declares exactly two inputs, `input_ids` and `encoder_hidden_states`. There's no `use_cache_branch`, no `past_key_values.*` inputs, and no `present.*` outputs. It's the plain decoder under the merged name. Its byte size matches `decoder_model.onnx` in the same repository to within a byte.

That isn't a slip by whoever made each export. manga-ocr's decoder is BERT, and Optimum, the usual tool for exporting to ONNX, can't export a BERT decoder with a cache. Its `BertOnnxConfig` isn't an `OnnxConfigWithPast`, so asking for a vision encoder-decoder export with past key values stops with "The decoder part of the encoder-decoder model is bert which does not need past key values." With no cached decoder to publish, an export saves the plain decoder under the file name transformers.js loads.

So read the graph, not the file name. The input names sit at the *end* of the serialized protobuf, so a range request for the last 400 kB is enough to check, without downloading 117 MB.

## `pipeline()` feeds a "merged" decoder one token at a time, based on the file name

The easy way to run manga-ocr in transformers.js is `pipeline()` with the `image-to-text` task, which runs the decoder loop for you. It picks the decode path from the file name, and that goes wrong in a way that's hard to spot.

`encoder_decoder_prepare_inputs_for_generation` does `input_ids = input_ids.map((x) => [x.at(-1)])` whenever `model_inputs.past_key_values` is set. In other words, once there's a cache, it only sends the newest token. After each step, `getPastKeyValues` (in 4.3.0) builds a `DynamicCache` from the decoder's `present.*` outputs and puts it there. That's an object, so it's truthy even when it's empty, and empty is exactly what you get when the session has no `present.*` outputs to collect. So from the second step on, the decoder gets a one-token prompt with no history and no cache. I traced it on a real run of `image-to-text`:

| Decoder call | `input_ids` |
| --- | --- |
| 0 | dims `[1, 1]`, `[2]` |
| 1 | dims `[1, 1]`, `[2]` |
| 2 | dims `[1, 1]`, `[2]` |
| 3 | dims `[1, 1]`, `[933]` |

What comes out looks like fluent Japanese, is completely wrong, and changes with the image. So it doesn't look like a broken pipeline: someone reads a bubble and gets a plausible line of text that has nothing to do with it. `use_cache: false` doesn't help. `num_beams: 1` produces the same characters as `num_beams: 4`, and that's the giveaway: the prefix isn't reaching the model at all.

**Driving the two sessions by hand takes a dozen lines, and it's correct.** Run the encoder once. Then feed the *whole* prefix to the decoder on every step and take the argmax (the highest-scoring token) at the last position. Same weights, same processor, same tokenizer:

| Rendered sample | `pipeline()` | own loop |
| --- | --- | --- |
| ありがとう | ん候娠振毛り乗柄お… | ありがとう |
| おはよう | ん娠候構おば斥帳根… | おはよう |
| こんにちは、元気ですか？ | ん娠の斥表に雇毛裏… | こんにちは、元気ですか? |

That's also why a hand-written loop like this has no beam search: the generation options never reach a decode that works. A cached decode and beam search both need an export that's really merged.

## CTC decoding, and the collapse that looks right and is not

A CTC model (like a PaddleOCR line recognizer) outputs a score for every character at every horizontal step across the line, plus a blank that means "no character here". Several steps in a row usually pick the same character, so decoding has to collapse them.

Take the argmax at each timestep, drop the blank index, and collapse any run of the same index into one. The order matters: **`previous` gets assigned on every step, including blanks.** A blank between two identical indices is exactly what makes them two characters instead of one. If you deduplicate the sequence first and remove blanks afterwards, `A · blank · A` reads as a single `A`. Nothing reports an error, and it happens on exactly the words a reader is most likely to notice.

A PaddleOCR rec graph's output rows sum to 1, because the softmax is part of the graph. So the mean of the chosen probabilities is a real confidence, not a made-up one.

## A character-level WordPiece decode puts a space between every character

manga-ocr's vocabulary is single characters with no `##` continuation marking. WordPiece uses `##` to mark a piece that continues the previous one, and without it every token is treated as a separate word. So `tokenizer.decode` joins them with spaces and returns `こ ん に ち は`.

The reference implementation strips all whitespace in its post-processing, and any port of it has to do the same, with a pure post-processing function applied to the decoded string. It isn't a tokenizer bug, and no option turns it off.
