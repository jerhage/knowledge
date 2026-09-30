---
title: Loading Hub Models in transformers.js
description: Loading a bare ONNX graph through `PreTrainedModel`, checking a repository before trusting it, and how `dtype` names files.
tags: [machine-learning, transformers-js, onnx]
sidebar:
  order: 3
---

transformers.js loads a model from a repository on the Hugging Face Hub by its id: it fetches the repository's config and ONNX files and opens them as ONNX Runtime sessions. That goes wrong in three places: a model that isn't a transformers model at all, a repository that looks usable and isn't, and precision settings that load the wrong file without any error. What happens once a model is loaded and producing tokens is in [Decoding Model Output](/machine-learning/decoding-model-output/). Getting the files onto the device is in [Model Downloads](/machine-learning/model-downloads/).

## A bare ONNX graph loads through `PreTrainedModel`, with no onnxruntime import

Some models are just one ONNX graph with no transformers config, like a PaddleOCR export. For one of those, I only want a raw ONNX Runtime session that I can run myself. The obvious routes to one are closed.

`@huggingface/transformers` only exports `"."`. So `src/backends/onnx.js` and its `createInferenceSession` can't be reached, and `env.backends.onnx` is the runtime's `Env` (log levels, WASM paths), which has no `InferenceSession`. `onnxruntime-web` may be on disk as a transitive dependency. But under Deno it sits in `node_modules/.deno/node_modules/`, which Node resolution never searches, so a bare import doesn't build.

The public way to get a raw session:

```ts
const model = await PreTrainedModel.from_pretrained(id, {
  config: new PretrainedConfig({ model_type: 'custom' }),
  model_file_name: 'inference',
  subfolder: '',
  device,
  dtype: 'fp32',
});
const session = model.sessions.model;
```

What makes it work, each part useful to know on its own:

- `AutoConfig.from_pretrained` is `config ?? loadConfig(...)`. **Passing a config skips the `config.json` fetch**, so a repository that doesn't publish one still loads.
- A model type that isn't registered falls through to `MODEL_SESSION_CONFIG.default`, whose sessions are `{ model: options.model_file_name ?? 'model' }`. So you get one file and one session, and you pick the name.
- `getCoreModelFile` builds `${subfolder ?? ''}/${fileName}${suffix}.onnx`, and `pathJoin` strips the leading slash of every part after the first. **So an empty `subfolder` means the repository root**, which is where a Paddle export puts its graph.

`model_type: 'custom'` is what keeps the logs quiet. Every other value logs "Model type for '…' not found, assuming encoder-only architecture".

Passing a transformers `Tensor` straight to `session.run()` works, because ORT accepts it. The outputs come back as raw ORT tensors with `dims` and `data`, not wrapped, because this skips `sessionRun`'s `replaceTensors`.

**Reading a graph's shapes without an onnx library.** Sometimes I need one fact about a graph before running it, like how many classes an output has. An ONNX file is a protobuf, so a few field numbers are enough. `ModelProto` field 7 is the graph. In `GraphProto`, field 11 is each input and field 12 each output. In `ValueInfoProto`, field 1 is the name and field 2 the type, down through `tensor_type` → `shape` → `dim` → `dim_value` or `dim_param`. A thirty-line varint reader gets the class count of an output without downloading a whole toolchain.

## Four checks before a model id goes in the worker, and a tag is not one of them

Several repositories on the Hub publish manga-ocr as ONNX, and a repository can have a tag that says which library it's for. It's tempting to pick one by that tag. But `onnx-community/manga-ocr-base-ONNX` has the `transformers.js` tag and can't be loaded at all. The tag only shows that somebody meant the repository for this library. It doesn't show that the files are there. Check the files instead, in this order:

1. **A merged decoder, for an encoder-decoder model.** transformers.js hard-codes the session names. `MODEL_SESSION_CONFIG[MODEL_TYPES.Vision2Seq]` declares `sessions: () => ({ model: 'encoder_model', decoder_model_merged: 'decoder_model_merged' })`, and the function takes no arguments. So unlike a decoder-only model, there's no `model_file_name` override to point it somewhere else. `onnx/decoder_model_merged.onnx` has to exist or nothing loads. (Whether that file is really merged is another question: see [Decoding Model Output](/machine-learning/decoding-model-output/).)
2. **A preprocessor config.** `preprocessor_config.json` is what turns a crop into `pixel_values`. Without it there's no resize, no normalization and no input size.
3. **A tokenizer.** transformers.js fetches `tokenizer.json` and `tokenizer_config.json` and nothing else. A `vocab.txt` next to them is just decoration. It's never read.
4. **The tokenizer's vocabulary count against the config's `vocab_size`.** A file listing can't settle this one. It's also the only check where a failure gives you plausible-looking nonsense instead of an error.

The manga-ocr repositories I looked at, on those checks (the last one, `kimchireader/manga-ocr-onnx-q8`, is my own export):

| Repository | Merged decoder | `tokenizer.json` entries | `vocab_size` |
| --- | --- | --- | --- |
| `onnx-community/manga-ocr-base-ONNX` | no | no such file | 6144 |
| `ms57rd/manga-ocr-base-ONNX` | yes | 5, the special tokens only | 6144 |
| `dnouv/manga-ocr` | yes | 1094, a different vocabulary | 6144 |
| `DigitalLarynx/manga-ocr-onnx` | yes | 6144 | 6144 |
| `kimchireader/manga-ocr-onnx-q8` | yes, and a quantized one | 6144 | 6144 |

The fourth check is the one that fails silently. The model predicts token ids, and the tokenizer turns each id into a character. If the count differs from `vocab_size`, the model puts out ids the tokenizer has no entry for. `dnouv/manga-ocr` decodes `[2, 5, 100, 1500, 3000, 6000, 3]` to `"% п"`. A complete tokenizer decodes the same ids to six real characters.

The check is cheap because a tokenizer loads by itself. `AutoTokenizer.from_pretrained(id)` is about 100 kB, not 200 MB, so decode a spread of ids before committing to the weights.

## `dtype` is keyed by file name, not by session name

An encoder-decoder model has two halves, and a repository can publish each half at more than one precision (full-precision fp32, or a smaller quantized q8). You choose with the `dtype` option, either one value for everything or a record with one value per half. The record's keys are where it goes wrong.

`selectDtype(dtype, fileName, …)` looks up `dtype[fileName]`. For a vision encoder-decoder, the file names are `encoder_model` and `decoder_model_merged`: the *values* in the `sessions` record, not its keys. A key that matches nothing isn't an error. It logs `dtype not specified for "…"` at info level (not as a warning) and uses the device default (`q8` on `wasm`, `fp32` everywhere else). So `dtype: { encoder_model: 'q8', decoder_model: 'q8' }` quantizes the encoder and leaves the decoder at that default without a warning. That's fp32 on WebGPU, and on WASM it's only quantized by coincidence.

`DEFAULT_DTYPE_SUFFIX_MAPPING` turns the dtype into a file suffix: `fp32` to nothing, `q8` to `_quantized`, `q4` to `_q4`, `fp16` to `_fp16`. So a dtype names a file. If the repository doesn't publish the file for a dtype, you get the same 404 as with a wrong model id.
