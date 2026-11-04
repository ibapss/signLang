# Datasets

Status of every data source considered for the PSL translator. Every claim here
is marked as **verified** (I inspected the actual files), **from the card/paper**
(I read the description but not the data), or **unverified** (could not reach it).

Last updated: 2026-11-04 (milestone 1).

## Summary

| Source | Reachable from the build VM | License | Inspected | Usable for training |
|---|---|---|---|---|
| GitHub `sign-language-translator/sign-language-datasets` (PSL dictionary) | **Yes** | CC BY 4.0 | **Verified** | No (1 signer, 1 clip per sign). Useful for vocabulary, reference clips, and a test video. |
| Hugging Face `Bakhtyar12/Pakistani-Sign-Language` | **No**: host blocked | MIT (per the brief; card not read) | **Unverified** | Unknown until inspected |
| UAlpha40 (Mendeley Data `3pvnnckxyb` v3) | **No**: host blocked | Not confirmed | **Unverified** | Likely (Spelling mode), after landmark extraction |
| Pakistan Sign Language Dataset (Kaggle / opendata.com.pk) | **No**: host blocked | Not confirmed | **Unverified** | Supplementary at best |
| Our own recordings (Collect page) | n/a (to be built in milestone 4) | Ours | n/a | Yes: essential for signer-independent evaluation |

### What I need from you to unblock data

The environment's network policy refuses connections to these hosts. Add them
under **Network access → Allowed domains** in the cloud environment settings
(session title bar → environment menu → Edit; steps at
<https://code.claude.com/docs/en/cloud-environments#network-access>), keeping
"Allow package managers" ticked:

| Dataset | Domains to allow |
|---|---|
| Hugging Face PSL | `huggingface.co`, `cdn-lfs.huggingface.co`, `cdn-lfs.hf.co`, `cas-bridge.xethub.hf.co` (HF now serves large files through its Xet bridge; if a download still fails I will name the redirect host it hit) |
| UAlpha40 | `data.mendeley.com` (download redirects to `prod-dcd-datasets-cache-zipfiles.s3.eu-west-1.amazonaws.com`, which is already reachable but refuses unsigned requests) |
| Kaggle PSL | `www.kaggle.com` plus a Kaggle API token, **or** upload the zip. `opendata.com.pk` is an alternative mirror. |

Alternatively, download the archives yourself and upload them to the session (or
to a private release on this repo). Raw datasets stay out of git either way.

---

## 1. PSL dictionary: `sign-language-translator/sign-language-datasets` (verified)

- **Repo:** <https://github.com/sign-language-translator/sign-language-datasets> (commit at HEAD on 2026-11-04).
- **License:** CC BY 4.0 (`LICENSE` file in the repo). Attribution required; see `THIRD_PARTY.md`.
- **Origin (from `parallel_texts/pk-dictionary-mapping.json`):** "pakistan sign
  language videos taught in hamza foundation academy for the deaf, lahore, pakistan."
- **What I downloaded:** release `v0.0.4/pk-hfad-1.landmarks-mediapipe-image-csv.zip`
  (24.5 MB, 788 CSV files) and three individual videos from release `v0.0.2`
  (`good`, `help`, `house`). The full video zip (`v0.0.3`, 330 MB) and the
  world-coordinate landmark zip are also reachable but were not needed yet.

### Landmark files (verified by inspecting all 788 files)

- One CSV per sign, one row per video frame, 375 columns = **75 landmarks × 5 values**
  (`x, y, z, a, b`).
- Landmark order: **33 pose, then 21 left hand, then 21 right hand.** The
  order is not documented in the files. I worked it out by matching each hand
  block's wrist to the pose wrists. Block 1's wrist is nearest pose landmark 15
  (left wrist) in 9,393 of 10,495 frames where it is present (89.5%). Block 2's
  wrist is nearest pose landmark 16 (right wrist) in 26,153 of 26,569 frames
  (98.4%). The disagreements are probably crossed hands or handedness mislabels.
- Pose rows carry visibility/presence in `a, b`; hand rows have `a = b = 0`.
- **Missing hand:** all 105 values of that hand block are exactly `0`. There were
  no partially-zero hands.
- **Coordinates:** normalized image coordinates (x, y in [0, 1] of a 640×480
  frame; pose z is MediaPipe's relative depth; hand z ≈ 0 to −0.06).
- **Mirroring:** the videos are **not mirrored**. The signer's right hand
  (block 2) appears on the left of the image, and his wristwatch is on his left
  wrist, which appears on the right of the image.
- **Frames per clip:** min 27, median 51, max 169, at 25 fps (about 1–7 s).
- **Hand detection rate:** the left-hand block is present in 24% of frames and
  the right-hand block in 61% on average. The clips include rest poses at the
  start and end, and the extraction used an older MediaPipe. 288 of 788 signs
  have both blocks present in more than 30% of frames.
- **Contents:** 788 clips covering 776 distinct mapped signs, 50 English
  fingerspelling letters (single- and double-handed variants of a–z), 14
  numbers, and everyday words, places and religious terms. 18 extra
  "constructable" phrases are defined as concatenations of dictionary signs.
- **Signers:** one (the same man appears in every clip I viewed). No signer ID
  is in the file names. The README's "Replications (22 hrs)" set, recorded by
  other people, is **not published**: `asset_urls/archive-urls.json` has an
  empty file list.
- **Text mapping:** `pk-dictionary-mapping.json` gives English, Urdu and Hindi
  tokens for each sign (CC BY 4.0). It is useful as a starting point for
  `signs.json`, but the Urdu strings still need human review.

### Verdict

**Not trainable on its own.** One signer with one clip per sign gives no
within-class variation and no possibility of a signer-independent split. A model
trained on it would memorize one person. It is still valuable for:

1. **Vocabulary selection:** a reference clip shows how each candidate sign is
   performed.
2. **Collect page reference videos** (milestone 4), with attribution. The clips are
   small (115–345 KB each).
3. **The end-to-end test fixture:** a real person signing, under a license that
   allows redistribution. Used to build `e2e/fixtures/signer.mjpeg`.
4. **Possible extra training data** after re-extracting landmarks with the
   browser's `.task` models, as one more signer alongside larger sources.

---

## 2. Hugging Face `Bakhtyar12/Pakistani-Sign-Language` (unverified)

**Blocked:** `huggingface.co` refuses connections from this environment (proxy 403;
the web-fetch tool cannot resolve it either). I have **not** seen the card or
the arrays, so the brief's description is the only information I have:

- 30-frame sequences, 225 values per frame (left hand 63, right hand 63, pose 99),
  extracted with MediaPipe 0.8; alphabets, words and sentences; MIT license.
- A public web search confirms the dataset exists (Hugging Face sign-language
  listing). One third-party GitHub project reads it as letter folders named
  `Alif`, `Bay`, `Pay`, … with `.npy` files of shape `(30, 225)`. That is
  secondhand and not verified.

**Checks to run as soon as it is reachable** (scripted in
`training/inspect_hf.py`, milestone 3):

1. Read the card: license, MediaPipe version, signer information.
2. Block order: compare each hand block's wrist with the pose wrists, as for the dictionary above.
3. Is keypoint 0 zero in every block? That would mean wrist-relative coordinates, which rules out using absolute position as a feature.
4. How a missing hand is encoded: zeros or NaN.
5. Class list and samples per class, split into alphabet, words and sentences.
6. Whether the 30 frames are a fixed-length crop or resampled, and at what fps.
7. Signer or session metadata, to decide whether a signer split is possible.

## 3. UAlpha40, Mendeley Data (unverified)

- DOI 10.17632/3pvnnckxyb.3, paper DOI 10.1016/j.dib.2025.111342 (Data in Brief, 2025).
  Authors: Sameena Javaid, Shahood Sajid, Yusra Khan Baloch (Bahria University, Karachi).
- From search snippets of the paper and listing: 110 participants, 40 Urdu
  letters (36 static as JPG, 4 dynamic as MP4); 22,280 images, of which only
  2,897 are original and 19,383 are augmented; 393 videos.
- **Important:** the augmented images must be **excluded** or kept strictly in
  the same split as their source image. Otherwise near-duplicates leak across
  the train/test split and inflate accuracy.
- The license is not confirmed. The Mendeley page was unreachable and search
  snippets did not include it.
- Plan: extract landmarks with the same `hand_landmarker.task` used in the
  browser, in IMAGE mode for the photos and VIDEO mode for the clips.

## 4. Pakistan Sign Language Dataset, Kaggle / opendata.com.pk (unverified)

- From the brief and search results: 9 signers, 37 letters and 12 words, images
  plus 2D keypoints (the Kaggle title says "openPose"). Associated paper: "Dataset
  of Pakistan Sign Language and Automatic Recognition of Hand Configuration of
  Urdu Alphabet through Machine Learning", Data in Brief, 2021.
- OpenPose keypoints are not compatible with MediaPipe. We would re-extract
  from the images with our `.task` models.
- Both hosts are blocked.

---

## Proposed first vocabulary (milestone 1, provisional)

Selection rules: everyday use in a Deaf–hearing conversation, a reference clip
in the PSL dictionary (so we know which variant to record), and preferably
visually distinct motion or handshape. **The final list depends on the class list
of the Hugging Face dataset** (which signs have enough samples) and on measured
per-class accuracy. Signs the model cannot separate will be dropped.

| # | Gloss | Dictionary clip | Frames (L / R hand presence) | Why |
|---|---|---|---|---|
| 1 | HELP | `help` | 42 (0.52 / 0.57) | urgent, two-handed |
| 2 | DOCTOR | `doctor(physician)` | 44 (0.00 / 0.59) | medical |
| 3 | HOSPITAL | `hospital` | 58 (0.24 / 0.57) | medical |
| 4 | MEDICINE | `medication` | 57 (0.00 / 0.68) | medical |
| 5 | PAIN | `ache` | 54 (0.09 / 0.57) | medical |
| 6 | SICK | `ill` | 47 (0.60 / 0.60) | medical |
| 7 | WASHROOM | `washroom` | 63 (0.37 / 0.73) | basic need |
| 8 | EMERGENCY | `emergency` | 67 (0.40 / 0.46) | urgent |
| 9 | ME | `me` (also `i(me)`) | 36 (0.03 / 0.50) | pronoun, needed for phrases |
| 10 | YOU | `aap` | 40 (0.03 / 0.57) | pronoun |
| 11 | NAME | `name` | 38 (0.00 / 0.55) | introductions |
| 12 | WHAT | `what` | 36 (0.08 / 0.50) | question |
| 13 | WHO | `who` | 52 (0.19 / 0.42) | question |
| 14 | HOW | `kesy` | 56 (0.02 / 0.70) | question |
| 15 | GOOD | `good` | 35 (0.06 / 0.57) | answer / greeting reply |
| 16 | NO / NOT | `not` | 39 (0.18 / 0.38) | answer |
| 17 | SORRY | `forgive` | 47 (0.60 / 0.55) | politeness |
| 18 | WAIT | `wait` | 36 (0.00 / 0.56) | conversation control |
| 19 | AGAIN | `again` | 46 (0.13 / 0.54) | conversation control ("say again") |
| 20 | HOME | `house` | 52 (0.87 / 0.83) | place |
| 21 | SCHOOL | `school` | 53 (0.26 / 0.66) | place (example phrase in the brief) |
| 22 | WORK | `work` | 41 (0.00 / 0.61) | daily life |
| 23 | TODAY | `today` | 41 (0.00 / 0.59) | time |
| 24 | TOMORROW | `tomorrow` | 35 (0.14 / 0.37) | time |

The list is 24 signs on purpose: I expect to drop some after evaluation and land near 20.

**Important everyday signs that the dictionary does not contain.** I searched
the English and Urdu tokens for: hello / السلام علیکم, thank you / شکریہ,
yes / ہاں / جی, please, water / پانی, food / eat / کھانا, where / کہاں, go /
جانا, and khuda hafiz. I'll add them **only if** the Hugging Face dataset has
them with enough samples, or we record them ourselves with a Deaf PSL signer
confirming the variant. I will not guess what a sign looks like.

**Spelling mode (phase 2):** the Urdu alphabet from UAlpha40 (40 letters,
110 signers) once it is reachable. The Hugging Face alphabet folders and the
Kaggle dataset are possible supplements.
