import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, posix } from 'node:path';

export const PDF_PACKAGES = Object.freeze({ 'pdfjs-dist': '6.4.299', '@napi-rs/canvas': '1.0.11', 'tesseract.js': '7.0.0', '@tesseract.js-data/eng': '1.0.0', '@tesseract.js-data/kor': '1.0.0' });
export const TESSDATA_LICENSE = Object.freeze({
  url: 'https://raw.githubusercontent.com/naptha/tessdata/806cd9adc8c6e8abc11c782db1818c990576bebc/LICENSE',
  sha256: 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4',
});
// tr46@0.0.3 declares MIT but omitted the original text from its npm tarball.
export const TR46_LICENSE = Object.freeze({
  url: 'https://raw.githubusercontent.com/jsdom/tr46/6d09104f21991d496aa2a8535d21bdea91a9c216/LICENSE.md',
  sha256: '499d6d466d064e0460427967a344e2a32fcb86ea8c6cd1a285ec4f1fa03fba67',
});
// Original documents from the pinned canvas SBOM / Tesseract core submodules.
export const CANVAS_SBOM_SHA256 = 'af0b3af01a73d229ffabb515a7d6c0857784e359df39b0da59949e946415bf71';
export const NATIVE_NOTICE_SOURCES = Object.freeze([
  {"id":"canvas-expat-COPYING","component":"expat","revision":"6154446fccefbf3ca644894f598969113b0c7bcd","url":"https://chromium.googlesource.com/external/github.com/libexpat/libexpat.git/+/6154446fccefbf3ca644894f598969113b0c7bcd/COPYING?format=TEXT","encoding":"base64","sha256":"31b15de82aa19a845156169a17a5488bf597e561b2c318d159ed583139b25e87"},
  {"id":"canvas-freetype-LICENSE.TXT","component":"freetype","revision":"264b5fbf5b912b39f98d038bf75d39be0a73f21b","url":"https://chromium.googlesource.com/chromium/src/third_party/freetype2.git/+/264b5fbf5b912b39f98d038bf75d39be0a73f21b/LICENSE.TXT?format=TEXT","encoding":"base64","sha256":"bd36c8b474855fa294c2ec5c184544478ef3720aad37d65a6296a4f264fd2d3b"},
  {"id":"canvas-freetype-docs_FTL.TXT","component":"freetype","revision":"264b5fbf5b912b39f98d038bf75d39be0a73f21b","url":"https://chromium.googlesource.com/chromium/src/third_party/freetype2.git/+/264b5fbf5b912b39f98d038bf75d39be0a73f21b/docs/FTL.TXT?format=TEXT","encoding":"base64","sha256":"5a5ee54c5001bbad1cdc1a57cc3dd4c42199b2da09d39c7ee41fab002d02967f"},
  {"id":"canvas-freetype-docs_GPLv2.TXT","component":"freetype","revision":"264b5fbf5b912b39f98d038bf75d39be0a73f21b","url":"https://chromium.googlesource.com/chromium/src/third_party/freetype2.git/+/264b5fbf5b912b39f98d038bf75d39be0a73f21b/docs/GPLv2.TXT?format=TEXT","encoding":"base64","sha256":"c4120c6752c910c299e3bd9cb3a46ff262c268303ca2069b61f92f10a5656c18"},
  {"id":"canvas-brotli-LICENSE","component":"brotli","revision":"6d03dfbedda1615c4cba1211f8d81735575209c8","url":"https://skia.googlesource.com/external/github.com/google/brotli.git/+/6d03dfbedda1615c4cba1211f8d81735575209c8/LICENSE?format=TEXT","encoding":"base64","sha256":"3d180008e36922a4e8daec11c34c7af264fed5962d07924aea928c38e8663c94"},
  {"id":"canvas-harfbuzz-COPYING","component":"harfbuzz","revision":"9cb1fee51069b206effb4736e443b038d230789d","url":"https://chromium.googlesource.com/external/github.com/harfbuzz/harfbuzz.git/+/9cb1fee51069b206effb4736e443b038d230789d/COPYING?format=TEXT","encoding":"base64","sha256":"ba8f810f2455c2f08e2d56bb49b72f37fcf68f1f4fade38977cfd7372050ad64"},
  {"id":"canvas-icu-LICENSE","component":"icu","revision":"d578f2e8b7bd5938e21cfb6bf15c079e0aa5b738","url":"https://chromium.googlesource.com/chromium/deps/icu.git/+/d578f2e8b7bd5938e21cfb6bf15c079e0aa5b738/LICENSE?format=TEXT","encoding":"base64","sha256":"e55522d81edc687a341a4411e0776e54ca654e90147f354a90458aaced4116af"},
  {"id":"canvas-icu-license.html","component":"icu","revision":"d578f2e8b7bd5938e21cfb6bf15c079e0aa5b738","url":"https://chromium.googlesource.com/chromium/deps/icu.git/+/d578f2e8b7bd5938e21cfb6bf15c079e0aa5b738/license.html?format=TEXT","encoding":"base64","sha256":"c62d7697c03979f5056d28b338fafc7a1152820f7b379adf4a9d88cd37160f96"},
  {"id":"canvas-libjxl-LICENSE","component":"libjxl","revision":"332feb17d17311c748445f7ee75c4fb55cc38530","url":"https://chromium.googlesource.com/external/gitlab.com/wg1/jpeg-xl.git/+/332feb17d17311c748445f7ee75c4fb55cc38530/LICENSE?format=TEXT","encoding":"base64","sha256":"8405932022a556380c2d8c272eff154a923feb197233f348ce5f7334fb0a5ede"},
  {"id":"canvas-highway-LICENSE","component":"highway","revision":"457c891775a7397bdb0376bb1031e6e027af1c48","url":"https://chromium.googlesource.com/external/github.com/google/highway.git/+/457c891775a7397bdb0376bb1031e6e027af1c48/LICENSE?format=TEXT","encoding":"base64","sha256":"43070e2d4e532684de521b885f385d0841030efa2b1a20bafb76133a5e1379c1"},
  {"id":"canvas-highway-LICENSE-BSD3","component":"highway","revision":"457c891775a7397bdb0376bb1031e6e027af1c48","url":"https://chromium.googlesource.com/external/github.com/google/highway.git/+/457c891775a7397bdb0376bb1031e6e027af1c48/LICENSE-BSD3?format=TEXT","encoding":"base64","sha256":"d25e82e26acd42ca3ccc9993622631163425b869b9e16284226d534cff6470f2"},
  {"id":"canvas-libjpeg-turbo-LICENSE.md","component":"libjpeg-turbo","revision":"e14cbfaa85529d47f9f55b0f104a579c1061f9ad","url":"https://chromium.googlesource.com/chromium/deps/libjpeg_turbo.git/+/e14cbfaa85529d47f9f55b0f104a579c1061f9ad/LICENSE.md?format=TEXT","encoding":"base64","sha256":"96f5b328adbb78eeaaec6980d73fd558cb1e4d62560ed615646bc3cf5e532430"},
  {"id":"canvas-libjpeg-turbo-README.ijg","component":"libjpeg-turbo","revision":"e14cbfaa85529d47f9f55b0f104a579c1061f9ad","url":"https://chromium.googlesource.com/chromium/deps/libjpeg_turbo.git/+/e14cbfaa85529d47f9f55b0f104a579c1061f9ad/README.ijg?format=TEXT","encoding":"base64","sha256":"75815e3bf6484201a3c3d17a1bbf10f2e8e3237f84df10a2357ea896db2a81d6"},
  {"id":"canvas-libpng-LICENSE","component":"libpng","revision":"d5515b5b8be3901aac04e5bd8bd5c89f287bcd33","url":"https://skia.googlesource.com/third_party/libpng.git/+/d5515b5b8be3901aac04e5bd8bd5c89f287bcd33/LICENSE?format=TEXT","encoding":"base64","sha256":"bdb0a645ea18c60507d0368379b1ac5474b92255fcc2d115e07486a7672ba526"},
  {"id":"canvas-libwebp-COPYING","component":"libwebp","revision":"845d5476a866141ba35ac133f856fa62f0b7445f","url":"https://chromium.googlesource.com/webm/libwebp.git/+/845d5476a866141ba35ac133f856fa62f0b7445f/COPYING?format=TEXT","encoding":"base64","sha256":"5aec868f669e384a22372a4e8a1a6cd7d44c64cd451f960ca69cc170d1e13acf"},
  {"id":"canvas-libwebp-PATENTS","component":"libwebp","revision":"845d5476a866141ba35ac133f856fa62f0b7445f","url":"https://chromium.googlesource.com/webm/libwebp.git/+/845d5476a866141ba35ac133f856fa62f0b7445f/PATENTS?format=TEXT","encoding":"base64","sha256":"cc3273e0694ea5896145e0677699b53471b03ea43021ddc50e7923fbb9f5023c"},
  {"id":"canvas-libwebp-AUTHORS","component":"libwebp","revision":"845d5476a866141ba35ac133f856fa62f0b7445f","url":"https://chromium.googlesource.com/webm/libwebp.git/+/845d5476a866141ba35ac133f856fa62f0b7445f/AUTHORS?format=TEXT","encoding":"base64","sha256":"f9681940f35ab74858ac2717a511fa6237b67f65e99f457c21223e60a851c85a"},
  {"id":"canvas-wuffs-LICENSE","component":"wuffs","revision":"e3f919ccfe3ef542cfc983a82146070258fb57f8","url":"https://skia.googlesource.com/external/github.com/google/wuffs-mirror-release-c.git/+/e3f919ccfe3ef542cfc983a82146070258fb57f8/LICENSE?format=TEXT","encoding":"base64","sha256":"cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"},
  {"id":"canvas-zlib-LICENSE","component":"zlib","revision":"646b7f569718921d7d4b5b8e22572ff6c76f2596","url":"https://chromium.googlesource.com/chromium/src/third_party/zlib/+/646b7f569718921d7d4b5b8e22572ff6c76f2596/LICENSE?format=TEXT","encoding":"base64","sha256":"e1cfcc55c325b3f78cf55df9664abaa066e2271dffe8213347d9fccdfbac8f2c"},
  {"id":"canvas-skia-LICENSE","component":"Skia","revision":"95ee33d7ec7791ab9c071675710a14fe6408ae4f","url":"https://raw.githubusercontent.com/google/skia/95ee33d7ec7791ab9c071675710a14fe6408ae4f/LICENSE","sha256":"5f787c1dee3c56547f09ccc2906ab5f5293c4d8dd6c8654e573216c38e908dbd"},
  {"id":"canvas-LICENSE","component":"@napi-rs/canvas","revision":"adce718ec8ff82f9e896875752fd621c46b1c04e","url":"https://raw.githubusercontent.com/Brooooooklyn/canvas/adce718ec8ff82f9e896875752fd621c46b1c04e/LICENSE","sha256":"8802fecf9da4367bc23bcf20b21cc143785fc6c92b152f3fa7fbe6ce08d344d6"},
  {"id":"ocr-giflib-COPYING","component":"giflib","revision":"fa37672085ce4b3d62c51627ab3c8cf2dda8009a","url":"https://raw.githubusercontent.com/mirrorer/giflib/fa37672085ce4b3d62c51627ab3c8cf2dda8009a/COPYING","sha256":"0c9b7990ecdca88b676db232c226548ac408b279f550d424d996f0d83591dd8e"},
  {"id":"ocr-leptonica-leptonica-license.txt","component":"leptonica","revision":"4af068b56a9674da915debea4ed7e1b9885b17e8","url":"https://raw.githubusercontent.com/DanBloomberg/leptonica/4af068b56a9674da915debea4ed7e1b9885b17e8/leptonica-license.txt","sha256":"87829abb5bbb00b55a107365da89e9a33f86c4250169e5a1e5588505be7d5806"},
  {"id":"ocr-libjpeg-README","component":"libjpeg","revision":"6c0fcb8ddee365e7abc4d332662b06900612e923","url":"https://raw.githubusercontent.com/LuaDist/libjpeg/6c0fcb8ddee365e7abc4d332662b06900612e923/README","sha256":"c791da525733040e622ed257c7b096b8f5191b332604ead0c6bc2b54cbd8e0d1"},
  {"id":"ocr-libpng-LICENSE","component":"libpng","revision":"a37d4836519517bdce6cb9d956092321eca3e73b","url":"https://raw.githubusercontent.com/glennrp/libpng/a37d4836519517bdce6cb9d956092321eca3e73b/LICENSE","sha256":"33ba4e187d8b0c8d7ab2bc2e522bb095219e03089e9aa0122b4fb9eb2b7de82b"},
  {"id":"ocr-libwebp-COPYING","component":"libwebp","revision":"20ef03ee351d4ff03fc5ff3ec4804a879d1b9d5c","url":"https://raw.githubusercontent.com/webmproject/libwebp/20ef03ee351d4ff03fc5ff3ec4804a879d1b9d5c/COPYING","sha256":"5aec868f669e384a22372a4e8a1a6cd7d44c64cd451f960ca69cc170d1e13acf"},
  {"id":"ocr-libwebp-PATENTS","component":"libwebp","revision":"20ef03ee351d4ff03fc5ff3ec4804a879d1b9d5c","url":"https://raw.githubusercontent.com/webmproject/libwebp/20ef03ee351d4ff03fc5ff3ec4804a879d1b9d5c/PATENTS","sha256":"cc3273e0694ea5896145e0677699b53471b03ea43021ddc50e7923fbb9f5023c"},
  {"id":"ocr-openlibm-LICENSE.md","component":"openlibm","revision":"ae2d91698508701c83cab83714d42a1146dccf85","url":"https://raw.githubusercontent.com/JuliaMath/openlibm/ae2d91698508701c83cab83714d42a1146dccf85/LICENSE.md","sha256":"b1843fbf5b03f519a5f0a44fce751bdd1022ae7148614923f9d6293e17a18b17"},
  {"id":"ocr-tesseract-LICENSE","component":"tesseract","revision":"2a9c1c49c360462733c386d2a44fcd22c4e21411","url":"https://raw.githubusercontent.com/Balearica/tesseract/2a9c1c49c360462733c386d2a44fcd22c4e21411/LICENSE","sha256":"cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"},
  {"id":"ocr-zlib-README","component":"zlib","revision":"21767c654d31d2dccdde4330529775c6c5fd5389","url":"https://raw.githubusercontent.com/madler/zlib/21767c654d31d2dccdde4330529775c6c5fd5389/README","sha256":"fc2c3368901700f0acdeb1d8afeaca5923296768ec6824ecdf627aac396001fd"},
  {"id":"ocr-libtiff-COPYRIGHT","component":"libtiff","revision":"b51bb157123264e26d34c09cc673d213aea61fc7","url":"https://gitlab.com/libtiff/libtiff/-/raw/b51bb157123264e26d34c09cc673d213aea61fc7/COPYRIGHT","sha256":"fbd6fed7938541d2c809c0826225fc85e551fdbfa8732b10f0c87e0847acafd7"},
  {"id":"rust-simd-LICENSE","component":"rust-simd","revision":"d74c030d9dc4f3cae02146d1f497ff62726ef09a","url":"https://raw.githubusercontent.com/Nugine/simd/d74c030d9dc4f3cae02146d1f497ff62726ef09a/LICENSE","sha256":"71674605ec4c087fe9eb534e3e4f9e26eb2e4aabcd76a29fd156c6a844d44b3d"},
  {"id":"rust-napi-LICENSE","component":"rust-napi","revision":"956e4525fea6a676ea3680b711382f167b899af9","url":"https://raw.githubusercontent.com/napi-rs/napi-rs/956e4525fea6a676ea3680b711382f167b899af9/LICENSE","sha256":"3f1ce66533302df3a32edbfdfc0b78f0dd34659e4c1f5817162e5ea3c2297215"},
  {"id":"rust-napi-sys-LICENSE","component":"rust-napi-sys","revision":"679eb79f5cf3c7c6b2850f4ab46092126f23dc5c","url":"https://raw.githubusercontent.com/napi-rs/napi-rs/679eb79f5cf3c7c6b2850f4ab46092126f23dc5c/LICENSE","sha256":"3f1ce66533302df3a32edbfdfc0b78f0dd34659e4c1f5817162e5ea3c2297215"},
]);
// Crates.io archive SHA256 values are the checksums in the pinned native SBOM.
export const RUST_NOTICE_ARCHIVES = Object.freeze([
  {"name":"aho-corasick","version":"1.1.4","url":"https://static.crates.io/crates/aho-corasick/aho-corasick-1.1.4.crate","sha256":"ddd31a130427c27518df266943a5308ed92d4b226cc639f5a8f1002816174301","files":[{"path":"aho-corasick-1.1.4/COPYING","sha256":"01c266bced4a434da0051174d6bee16a4c82cf634e2679b6155d40d75012390f"},{"path":"aho-corasick-1.1.4/LICENSE-MIT","sha256":"0f96a83840e146e43c0ec96a22ec1f392e0680e6c1226e6f3ba87e0740af850f"},{"path":"aho-corasick-1.1.4/UNLICENSE","sha256":"7e12e5df4bae12cb21581ba157ced20e1986a0508dd10d0e8a4ab9a4cf94e85c"}]},
  {"name":"anyhow","version":"1.0.104","url":"https://static.crates.io/crates/anyhow/anyhow-1.0.104.crate","sha256":"330a5ed07fa54e4702c9d6c4174f74427fc0ef6e214bbd677ae50a5099946470","files":[{"path":"anyhow-1.0.104/LICENSE-APACHE","sha256":"62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a"},{"path":"anyhow-1.0.104/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"bitflags","version":"2.13.1","url":"https://static.crates.io/crates/bitflags/bitflags-2.13.1.crate","sha256":"b588b76d00fde79687d7646a9b5bdf3cc0f655e0bbd080335a95d7e96f3587da","files":[{"path":"bitflags-2.13.1/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"bitflags-2.13.1/LICENSE-MIT","sha256":"6485b8ed310d3f0340bf1ad1f47645069ce4069dcc6bb46c7d5c6faf41de1fdb"}]},
  {"name":"bumpalo","version":"3.20.3","url":"https://static.crates.io/crates/bumpalo/bumpalo-3.20.3.crate","sha256":"72f5acc6cb2ba439de613abc23857ec3d78374d8ed5ac84e9d11336e87da8649","files":[{"path":"bumpalo-3.20.3/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"bumpalo-3.20.3/LICENSE-MIT","sha256":"65f94e99ddaf4f5d1782a6dae23f35d4293a9a01444a13135a6887017d353cee"}]},
  {"name":"bytemuck","version":"1.25.2","url":"https://static.crates.io/crates/bytemuck/bytemuck-1.25.2.crate","sha256":"95832e849adfb21180ccb6826a99da14e5d266ae5c2e668e1602cf234f153797","files":[{"path":"bytemuck-1.25.2/LICENSE-APACHE","sha256":"e3ba223bb1423f0aad8c3dfce0fe3148db48926d41e6fbc3afbbf5ff9e1c89cb"},{"path":"bytemuck-1.25.2/LICENSE-MIT","sha256":"9df9ba60a11af705f2e451b53762686e615d86f76b169cf075c3237730dbd7e2"},{"path":"bytemuck-1.25.2/LICENSE-ZLIB","sha256":"84b34dd7608f7fb9b17bd588a6bf392bf7de504e2716f024a77d89f1b145a151"}]},
  {"name":"cc","version":"1.4.0","url":"https://static.crates.io/crates/cc/cc-1.4.0.crate","sha256":"5add81bb678e6cb321aff7fa0dc7689ad82b112dbc032cea19f91d6b8e3582b9","files":[{"path":"cc-1.4.0/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"cc-1.4.0/LICENSE-MIT","sha256":"378f5840b258e2779c39418f3f2d7b2ba96f1c7917dd6be0713f88305dbda397"}]},
  {"name":"cfb","version":"0.14.0","url":"https://static.crates.io/crates/cfb/cfb-0.14.0.crate","sha256":"a347dcabdae9c31b0825fd6a8bed285ec9c2acb89c47827126d52fa4f59cece3","files":[{"path":"cfb-0.14.0/LICENSE","sha256":"ebaac853b53fec0ed475796f533ce676912a4df9ad9d8a621fa76d5060591e10"}]},
  {"name":"cfg-if","version":"1.0.4","url":"https://static.crates.io/crates/cfg-if/cfg-if-1.0.4.crate","sha256":"9330f8b2ff13f34540b44e946ef35111825727b38d33286ef986142615121801","files":[{"path":"cfg-if-1.0.4/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"cfg-if-1.0.4/LICENSE-MIT","sha256":"378f5840b258e2779c39418f3f2d7b2ba96f1c7917dd6be0713f88305dbda397"}]},
  {"name":"cmake","version":"0.1.58","url":"https://static.crates.io/crates/cmake/cmake-0.1.58.crate","sha256":"c0f78a02292a74a88ac736019ab962ece0bc380e3f977bf72e376c5d78ff0678","files":[{"path":"cmake-0.1.58/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"cmake-0.1.58/LICENSE-MIT","sha256":"378f5840b258e2779c39418f3f2d7b2ba96f1c7917dd6be0713f88305dbda397"}]},
  {"name":"color_quant","version":"1.1.0","url":"https://static.crates.io/crates/color_quant/color_quant-1.1.0.crate","sha256":"3d7b894f5411737b7867f4827955924d7c254fc9f4d91a6aad6b097804b1018b","files":[{"path":"color_quant-1.1.0/LICENSE","sha256":"592dc80f1a865d20d61a2006a2d29ce34a2bc28cd7e868ab300fdeed6da154ca"}]},
  {"name":"convert_case","version":"0.11.0","url":"https://static.crates.io/crates/convert_case/convert_case-0.11.0.crate","sha256":"affbf0190ed2caf063e3def54ff444b449371d55c58e513a95ab98eca50adb49","files":[{"path":"convert_case-0.11.0/LICENSE","sha256":"aed7b1758e35afa0cd0fde059d61950747ca11cd0e5e169cb21c11608daed772"}]},
  {"name":"cssparser","version":"0.38.0","url":"https://static.crates.io/crates/cssparser/cssparser-0.38.0.crate","sha256":"11119743ad110e8c1bdccd930d7f5c30c99e5fc76a7b63ec9807e84eef0c5f59","files":[{"path":"cssparser-0.38.0/LICENSE","sha256":"fab3dd6bdab226f1c08630b1dd917e11fcb4ec5e1e020e2c16f83a0a13863e85"}]},
  {"name":"cssparser-color","version":"0.6.0","url":"https://static.crates.io/crates/cssparser-color/cssparser-color-0.6.0.crate","sha256":"cc0e59e8bcc238f0f9b9f29f4d649e5c192dbf277999d0c23d1a312af3fb7a3e","files":[{"path":"cssparser-color-0.6.0/LICENSE","sha256":"fab3dd6bdab226f1c08630b1dd917e11fcb4ec5e1e020e2c16f83a0a13863e85"}]},
  {"name":"cssparser-macros","version":"0.7.0","url":"https://static.crates.io/crates/cssparser-macros/cssparser-macros-0.7.0.crate","sha256":"10a2a99df6e410a8ff4245aa2006499ea662245f967cc7c0a38c83ef8eb44dbf","files":[{"path":"cssparser-macros-0.7.0/LICENSE","sha256":"fab3dd6bdab226f1c08630b1dd917e11fcb4ec5e1e020e2c16f83a0a13863e85"}]},
  {"name":"ctor","version":"1.0.11","url":"https://static.crates.io/crates/ctor/ctor-1.0.11.crate","sha256":"e9bb72bb94fdc1bd619f4c18cc91ecf6302aeb333d31b3c6ec0bb841cd920209","files":[{"path":"ctor-1.0.11/LICENSE-APACHE","sha256":"a8ad31b1c3f40dca5a84119351b8fa8ddc868edd77fad8a8ebf6d8f2d16fa4ae"},{"path":"ctor-1.0.11/LICENSE-MIT","sha256":"bccaa8b6c09f94e81f06696e179dbe058464bbdfbc823b6d49cada1d71e84ac3"}]},
  {"name":"dtoa","version":"1.0.11","url":"https://static.crates.io/crates/dtoa/dtoa-1.0.11.crate","sha256":"4c3cf4824e2d5f025c7b531afcb2325364084a16806f6d47fbc1f5fbd9960590","files":[{"path":"dtoa-1.0.11/LICENSE-APACHE","sha256":"62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a"},{"path":"dtoa-1.0.11/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"dtoa-short","version":"0.3.5","url":"https://static.crates.io/crates/dtoa-short/dtoa-short-0.3.5.crate","sha256":"cd1511a7b6a56299bd043a9c167a6d2bfb37bf84a6dfceaba651168adfb43c87","files":[{"path":"dtoa-short-0.3.5/LICENSE","sha256":"1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5"}]},
  {"name":"fastrand","version":"2.5.0","url":"https://static.crates.io/crates/fastrand/fastrand-2.5.0.crate","sha256":"da7c62ceae207dd37ea5b845da6a0696c799f85e97da1ab5b7910be3c1c80223","files":[{"path":"fastrand-2.5.0/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"fastrand-2.5.0/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"find-msvc-tools","version":"0.1.9","url":"https://static.crates.io/crates/find-msvc-tools/find-msvc-tools-0.1.9.crate","sha256":"5baebc0774151f905a1a2cc41989300b1e6fbb29aff0ceffa1064fdd3088d582","files":[{"path":"find-msvc-tools-0.1.9/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"find-msvc-tools-0.1.9/LICENSE-MIT","sha256":"378f5840b258e2779c39418f3f2d7b2ba96f1c7917dd6be0713f88305dbda397"}]},
  {"name":"fnv","version":"1.0.7","url":"https://static.crates.io/crates/fnv/fnv-1.0.7.crate","sha256":"3f9eec918d3f24069decb9af1554cad7c880e2da24a9afd88aca000531ab82c1","files":[{"path":"fnv-1.0.7/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"fnv-1.0.7/LICENSE-MIT","sha256":"65fdb6c76cd61612070c066eec9ecdb30ee74fb27859d0d9af58b9f499fd0c3e"}]},
  {"name":"futures","version":"0.3.33","url":"https://static.crates.io/crates/futures/futures-0.3.33.crate","sha256":"a88cf1f829d945f548cf8fec32c61b1f202b6d93b45848602fc02af4b12ad218","files":[{"path":"futures-0.3.33/LICENSE-APACHE","sha256":"275c491d6d1160553c32fd6127061d7f9606c3ea25abfad6ca3f6ed088785427"},{"path":"futures-0.3.33/LICENSE-MIT","sha256":"6652c868f35dfe5e8ef636810a4e576b9d663f3a17fb0f5613ad73583e1b88fd"}]},
  {"name":"futures-channel","version":"0.3.33","url":"https://static.crates.io/crates/futures-channel/futures-channel-0.3.33.crate","sha256":"262590f4fe6afeb0bc83be1daa64e52657fe185690a958af7f3ad0e92085c5ae","files":[{"path":"futures-channel-0.3.33/LICENSE-APACHE","sha256":"275c491d6d1160553c32fd6127061d7f9606c3ea25abfad6ca3f6ed088785427"},{"path":"futures-channel-0.3.33/LICENSE-MIT","sha256":"6652c868f35dfe5e8ef636810a4e576b9d663f3a17fb0f5613ad73583e1b88fd"}]},
  {"name":"futures-core","version":"0.3.33","url":"https://static.crates.io/crates/futures-core/futures-core-0.3.33.crate","sha256":"2cd50c473c80f6d7c3670a752354b8e569b1a7cbfdc0419ec88e5edad85e0dc7","files":[{"path":"futures-core-0.3.33/LICENSE-APACHE","sha256":"275c491d6d1160553c32fd6127061d7f9606c3ea25abfad6ca3f6ed088785427"},{"path":"futures-core-0.3.33/LICENSE-MIT","sha256":"6652c868f35dfe5e8ef636810a4e576b9d663f3a17fb0f5613ad73583e1b88fd"}]},
  {"name":"futures-executor","version":"0.3.33","url":"https://static.crates.io/crates/futures-executor/futures-executor-0.3.33.crate","sha256":"6754879cc9f2c66f88c6e5c35344bb0bdb0708b0352b1201815667c7eabc7458","files":[{"path":"futures-executor-0.3.33/LICENSE-APACHE","sha256":"275c491d6d1160553c32fd6127061d7f9606c3ea25abfad6ca3f6ed088785427"},{"path":"futures-executor-0.3.33/LICENSE-MIT","sha256":"6652c868f35dfe5e8ef636810a4e576b9d663f3a17fb0f5613ad73583e1b88fd"}]},
  {"name":"futures-io","version":"0.3.33","url":"https://static.crates.io/crates/futures-io/futures-io-0.3.33.crate","sha256":"4577ecaa3c4f96589d473f679a71b596316f6641bc350038b962a5daf0085d7a","files":[{"path":"futures-io-0.3.33/LICENSE-APACHE","sha256":"275c491d6d1160553c32fd6127061d7f9606c3ea25abfad6ca3f6ed088785427"},{"path":"futures-io-0.3.33/LICENSE-MIT","sha256":"6652c868f35dfe5e8ef636810a4e576b9d663f3a17fb0f5613ad73583e1b88fd"}]},
  {"name":"futures-macro","version":"0.3.33","url":"https://static.crates.io/crates/futures-macro/futures-macro-0.3.33.crate","sha256":"2d6d3cde68c518367be28956066ddfef33813991b77a55005a69dae04bf3b10b","files":[{"path":"futures-macro-0.3.33/LICENSE-APACHE","sha256":"275c491d6d1160553c32fd6127061d7f9606c3ea25abfad6ca3f6ed088785427"},{"path":"futures-macro-0.3.33/LICENSE-MIT","sha256":"6652c868f35dfe5e8ef636810a4e576b9d663f3a17fb0f5613ad73583e1b88fd"}]},
  {"name":"futures-sink","version":"0.3.33","url":"https://static.crates.io/crates/futures-sink/futures-sink-0.3.33.crate","sha256":"e34418ac499d6305c2fb5ad0ed2f6ac998c5f8ca209b4510f7f94242c647e307","files":[{"path":"futures-sink-0.3.33/LICENSE-APACHE","sha256":"275c491d6d1160553c32fd6127061d7f9606c3ea25abfad6ca3f6ed088785427"},{"path":"futures-sink-0.3.33/LICENSE-MIT","sha256":"6652c868f35dfe5e8ef636810a4e576b9d663f3a17fb0f5613ad73583e1b88fd"}]},
  {"name":"futures-task","version":"0.3.33","url":"https://static.crates.io/crates/futures-task/futures-task-0.3.33.crate","sha256":"b231ed28831efb4a61a08580c4bc233ec56bc009f4cd8f52da2c3cb97df0c109","files":[{"path":"futures-task-0.3.33/LICENSE-APACHE","sha256":"275c491d6d1160553c32fd6127061d7f9606c3ea25abfad6ca3f6ed088785427"},{"path":"futures-task-0.3.33/LICENSE-MIT","sha256":"6652c868f35dfe5e8ef636810a4e576b9d663f3a17fb0f5613ad73583e1b88fd"}]},
  {"name":"futures-util","version":"0.3.33","url":"https://static.crates.io/crates/futures-util/futures-util-0.3.33.crate","sha256":"a77a90a256fce34da66415271e30f94ee91c57b04b8a2c042d9cf3220179deaa","files":[{"path":"futures-util-0.3.33/LICENSE-APACHE","sha256":"275c491d6d1160553c32fd6127061d7f9606c3ea25abfad6ca3f6ed088785427"},{"path":"futures-util-0.3.33/LICENSE-MIT","sha256":"6652c868f35dfe5e8ef636810a4e576b9d663f3a17fb0f5613ad73583e1b88fd"}]},
  {"name":"gif","version":"0.14.2","url":"https://static.crates.io/crates/gif/gif-0.14.2.crate","sha256":"ee8cfcc411d9adbbaba82fb72661cc1bcca13e8bba98b364e62b2dba8f960159","files":[{"path":"gif-0.14.2/LICENSE-APACHE","sha256":"769f80b5bcb42ed0af4e4d2fd74e1ac9bf843cb80c5a29219d1ef3544428a6bb"},{"path":"gif-0.14.2/LICENSE-MIT","sha256":"77257f3d2181236b1aee78920238062ae64efe13c5d858b2db126e79c9e1b14f"}]},
  {"name":"hermit-abi","version":"0.5.2","url":"https://static.crates.io/crates/hermit-abi/hermit-abi-0.5.2.crate","sha256":"fc0fef456e4baa96da950455cd02c081ca953b141298e41db3fc7e36b1da849c","files":[{"path":"hermit-abi-0.5.2/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"hermit-abi-0.5.2/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"imagesize","version":"0.15.0","url":"https://static.crates.io/crates/imagesize/imagesize-0.15.0.crate","sha256":"65b27460c2c92b037f3f94c538ed9a3342f3fdf923606781629ccb35f82d042a","files":[{"path":"imagesize-0.15.0/LICENSE","sha256":"fa0d694967d5c279e70a5c7b7e4b9929e4c1c8c1b8506998e66fc2f1547b200a"}]},
  {"name":"infer","version":"0.22.0","url":"https://static.crates.io/crates/infer/infer-0.22.0.crate","sha256":"f4200d433cbd5178df7797c9c2e75b348b728e39631cf14520d1e2fc424201f4","files":[{"path":"infer-0.22.0/LICENSE","sha256":"270b0d81891aa44c7e8726cf9432dade9556a01c848bacd2f3ef839c9c1a1859"}]},
  {"name":"itoa","version":"1.0.18","url":"https://static.crates.io/crates/itoa/itoa-1.0.18.crate","sha256":"8f42a60cbdf9a97f5d2305f08a87dc4e09308d1276d28c869c684d7777685682","files":[{"path":"itoa-1.0.18/LICENSE-APACHE","sha256":"62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a"},{"path":"itoa-1.0.18/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"js-sys","version":"0.3.103","url":"https://static.crates.io/crates/js-sys/js-sys-0.3.103.crate","sha256":"53b44bfcdb3f8d5837a46dae1ca9660a837176eee74a28b229bc626816589102","files":[{"path":"js-sys-0.3.103/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"js-sys-0.3.103/LICENSE-MIT","sha256":"378f5840b258e2779c39418f3f2d7b2ba96f1c7917dd6be0713f88305dbda397"}]},
  {"name":"libaom-sys","version":"0.17.2+libaom.3.11.0","url":"https://static.crates.io/crates/libaom-sys/libaom-sys-0.17.2+libaom.3.11.0.crate","sha256":"7c4fce8aaf0c2d8534529b0698ed98ec1da8d35319588d20b0d79ce6446e4194","files":[{"path":"libaom-sys-0.17.2+libaom.3.11.0/vendor/LICENSE","sha256":"4764a286d8b2faeaf42f4418e7d7a28d58fc8fd4d00a3d0a7f44b0a4099de7f2"},{"path":"libaom-sys-0.17.2+libaom.3.11.0/vendor/third_party/SVT-AV1/LICENSE.md","sha256":"0acc2fcb27472bdc9aaf8b71f37055bbdac4f54671b7d922f241bd7fcd0dd3e6"},{"path":"libaom-sys-0.17.2+libaom.3.11.0/vendor/third_party/fastfeat/LICENSE","sha256":"043dcfd059386f9facd376351b2bd79325778744aa442177390cdfcca54babed"},{"path":"libaom-sys-0.17.2+libaom.3.11.0/vendor/third_party/libwebm/LICENSE.TXT","sha256":"5aec868f669e384a22372a4e8a1a6cd7d44c64cd451f960ca69cc170d1e13acf"},{"path":"libaom-sys-0.17.2+libaom.3.11.0/vendor/third_party/libyuv/LICENSE","sha256":"2b2cc1180c7e6988328ad2033b04b80117419db9c4c584918bbb3cfec7e9364f"},{"path":"libaom-sys-0.17.2+libaom.3.11.0/vendor/third_party/vector/LICENSE","sha256":"ff6c857ce2708e87701323078aef115c1872a1f80a9649f86dc899b48083bc60"},{"path":"libaom-sys-0.17.2+libaom.3.11.0/vendor/third_party/x86inc/LICENSE","sha256":"719d8fa235f2068e0ae6d6a7dceb0a7720d7840f0f0ebed29957989e6ded3cd8"}]},
  {"name":"libavif","version":"0.14.0","url":"https://static.crates.io/crates/libavif/libavif-0.14.0.crate","sha256":"0b710faf0de92da0e32a9a9c89bbf849e37277fd447b4f17b0f0f798796ae1f2","files":[{"path":"libavif-0.14.0/LICENSE","sha256":"fe490679de7d4c113698ef4a4f130b10c2b561f6b847db87efbaefa64b9ac057"}]},
  {"name":"libavif-sys","version":"0.17.0+libavif.1.0.4","url":"https://static.crates.io/crates/libavif-sys/libavif-sys-0.17.0+libavif.1.0.4.crate","sha256":"490ca74b61e773140bebb086c81facb23273a99364a9ab0c92ab1532b90ade35","files":[{"path":"libavif-sys-0.17.0+libavif.1.0.4/libavif/LICENSE","sha256":"10952217a6d404de8bf8a997fbea9b88f682df1fe98cb9b9f467ade641525639"}]},
  {"name":"libc","version":"0.2.189","url":"https://static.crates.io/crates/libc/libc-0.2.189.crate","sha256":"3eaf3ede3fee6db1a4c2ee091bf8a8b4dccdc6d17f656fb07896ee72867612f2","files":[{"path":"libc-0.2.189/LICENSE-APACHE","sha256":"62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a"},{"path":"libc-0.2.189/LICENSE-MIT","sha256":"123a331b5dbf04c30097fa43b8f858bc85df671fe776de498d01f3d6b7c1f69e"}]},
  {"name":"libloading","version":"0.9.0","url":"https://static.crates.io/crates/libloading/libloading-0.9.0.crate","sha256":"754ca22de805bb5744484a5b151a9e1a8e837d5dc232c2d7d8c2e3492edc8b60","files":[{"path":"libloading-0.9.0/LICENSE","sha256":"b29f8b01452350c20dd1af16ef83b598fea3053578ccc1c7a0ef40e57be2620f"}]},
  {"name":"libmimalloc-sys2","version":"0.1.60","url":"https://static.crates.io/crates/libmimalloc-sys2/libmimalloc-sys2-0.1.60.crate","sha256":"921641155d9dc4f434332abd912518e33c70e37c557434818b6cfd1fbbb6138d","files":[{"path":"libmimalloc-sys2-0.1.60/LICENSE.txt","sha256":"a08554fab028af3af047e8588d32d019662c1b1bf07959a195a2f75fe340726b"},{"path":"libmimalloc-sys2-0.1.60/c_src/mimalloc/LICENSE","sha256":"82ade5d7d9b029044b5fbbc326207fc47c2d44ee4dd71e8a559c36d728217de9"},{"path":"libmimalloc-sys2-0.1.60/c_src/mimalloc3/LICENSE","sha256":"82ade5d7d9b029044b5fbbc326207fc47c2d44ee4dd71e8a559c36d728217de9"}]},
  {"name":"memchr","version":"2.8.3","url":"https://static.crates.io/crates/memchr/memchr-2.8.3.crate","sha256":"cf8baf1c55e62ffcace7a9f06f4bd9cd3f0c4beb022d3b367256b91b87513d98","files":[{"path":"memchr-2.8.3/COPYING","sha256":"01c266bced4a434da0051174d6bee16a4c82cf634e2679b6155d40d75012390f"},{"path":"memchr-2.8.3/LICENSE-MIT","sha256":"0f96a83840e146e43c0ec96a22ec1f392e0680e6c1226e6f3ba87e0740af850f"},{"path":"memchr-2.8.3/UNLICENSE","sha256":"7e12e5df4bae12cb21581ba157ced20e1986a0508dd10d0e8a4ab9a4cf94e85c"}]},
  {"name":"mimalloc-safe","version":"0.1.64","url":"https://static.crates.io/crates/mimalloc-safe/mimalloc-safe-0.1.64.crate","sha256":"afd082b59cfceeb3bf31dbff65e7b96e1f94fa9b918e131d02353e6867a12824","files":[{"path":"mimalloc-safe-0.1.64/LICENSE.txt","sha256":"a08554fab028af3af047e8588d32d019662c1b1bf07959a195a2f75fe340726b"}]},
  {"name":"nohash-hasher","version":"0.2.0","url":"https://static.crates.io/crates/nohash-hasher/nohash-hasher-0.2.0.crate","sha256":"2bf50223579dc7cdcfb3bfcacf7069ff68243f8c363f62ffa99cf000a6b9c451","files":[{"path":"nohash-hasher-0.2.0/LICENSE-APACHE","sha256":"cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"},{"path":"nohash-hasher-0.2.0/LICENSE-MIT","sha256":"ec353d4fecf7963b4c054384557e5dbc3c7a717997eb4a3815b315721a6aa75a"}]},
  {"name":"nom","version":"8.0.0","url":"https://static.crates.io/crates/nom/nom-8.0.0.crate","sha256":"df9761775871bdef83bee530e60050f7e54b1105350d6884eb0fb4f46c2f9405","files":[{"path":"nom-8.0.0/LICENSE","sha256":"4dbda04344456f09a7a588140455413a9ac59b6b26a1ef7cdf9c800c012d87f0"}]},
  {"name":"num_cpus","version":"1.17.0","url":"https://static.crates.io/crates/num_cpus/num_cpus-1.17.0.crate","sha256":"91df4bbde75afed763b708b7eee1e8e7651e02d97f6d5dd763e89367e957b23b","files":[{"path":"num_cpus-1.17.0/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"num_cpus-1.17.0/LICENSE-MIT","sha256":"391a5396cec6230bfabd4ef4eb2350eb895bc5efce377a2218f5702ed020d3e3"}]},
  {"name":"once_cell","version":"1.21.4","url":"https://static.crates.io/crates/once_cell/once_cell-1.21.4.crate","sha256":"9f7c3e4beb33f85d45ae3e3a1792185706c8e16d043238c593331cc7cd313b50","files":[{"path":"once_cell-1.21.4/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"once_cell-1.21.4/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"outref","version":"0.5.2","url":"https://static.crates.io/crates/outref/outref-0.5.2.crate","sha256":"1a80800c0488c3a21695ea981a54918fbb37abf04f4d0720c453632255e2ff0e","files":[{"path":"outref-0.5.2/LICENSE","sha256":"a00511478c83ebb464ef19d840f061c7444adc4636bb561900e75c5808cfc6cc"}]},
  {"name":"phf","version":"0.14.0","url":"https://static.crates.io/crates/phf/phf-0.14.0.crate","sha256":"010378780309880b08997fae13be7834dba947d36393bd372f2b1556deb2a2f6","files":[{"path":"phf-0.14.0/LICENSE","sha256":"0ab4d106b6faac07fb6a051815fd1b4d862d730895e2d7d7358c2f13565e7a38"}]},
  {"name":"phf_generator","version":"0.14.0","url":"https://static.crates.io/crates/phf_generator/phf_generator-0.14.0.crate","sha256":"aeb62e0959d5a1bebc965f4d15d9e2b7cea002b6b0f5ba8cde6cc26738467100","files":[{"path":"phf_generator-0.14.0/LICENSE","sha256":"0ab4d106b6faac07fb6a051815fd1b4d862d730895e2d7d7358c2f13565e7a38"}]},
  {"name":"phf_macros","version":"0.14.0","url":"https://static.crates.io/crates/phf_macros/phf_macros-0.14.0.crate","sha256":"5fa8d0ca26d424d27630da600c6624696e7dec8bf7b3b492b383c5dc49e5e085","files":[{"path":"phf_macros-0.14.0/LICENSE","sha256":"0ab4d106b6faac07fb6a051815fd1b4d862d730895e2d7d7358c2f13565e7a38"}]},
  {"name":"phf_shared","version":"0.14.0","url":"https://static.crates.io/crates/phf_shared/phf_shared-0.14.0.crate","sha256":"c6fd9027e2d9319be6349febd1db4e8d02aa544921200c9b777720ac34a3aa89","files":[{"path":"phf_shared-0.14.0/LICENSE","sha256":"0ab4d106b6faac07fb6a051815fd1b4d862d730895e2d7d7358c2f13565e7a38"}]},
  {"name":"pin-project-lite","version":"0.2.17","url":"https://static.crates.io/crates/pin-project-lite/pin-project-lite-0.2.17.crate","sha256":"a89322df9ebe1c1578d689c92318e070967d1042b512afbe49518723f4e6d5cd","files":[{"path":"pin-project-lite-0.2.17/LICENSE-APACHE","sha256":"0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594"},{"path":"pin-project-lite-0.2.17/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"proc-macro2","version":"1.0.107","url":"https://static.crates.io/crates/proc-macro2/proc-macro2-1.0.107.crate","sha256":"985e7ec9bb745e6ce6535b544d84d6cd6f7ad8bd711c398938ae983b91a766d9","files":[{"path":"proc-macro2-1.0.107/LICENSE-APACHE","sha256":"62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a"},{"path":"proc-macro2-1.0.107/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"quote","version":"1.0.47","url":"https://static.crates.io/crates/quote/quote-1.0.47.crate","sha256":"1fbf4db142a473a8d80c26bbf18454ed458bf8d26c8219c331daecfdbd079001","files":[{"path":"quote-1.0.47/LICENSE-APACHE","sha256":"62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a"},{"path":"quote-1.0.47/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"regex","version":"1.13.1","url":"https://static.crates.io/crates/regex/regex-1.13.1.crate","sha256":"f020237b6c8eed93db2e2cb53c00c60a8e1bc73da7d073199a1180401450218d","files":[{"path":"regex-1.13.1/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"regex-1.13.1/LICENSE-MIT","sha256":"6485b8ed310d3f0340bf1ad1f47645069ce4069dcc6bb46c7d5c6faf41de1fdb"}]},
  {"name":"regex-automata","version":"0.4.16","url":"https://static.crates.io/crates/regex-automata/regex-automata-0.4.16.crate","sha256":"8fcfdb36bda0c880c5931cdc7a2bcdc8ba4556847b9d912bca70bc94708711ad","files":[{"path":"regex-automata-0.4.16/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"regex-automata-0.4.16/LICENSE-MIT","sha256":"6485b8ed310d3f0340bf1ad1f47645069ce4069dcc6bb46c7d5c6faf41de1fdb"}]},
  {"name":"regex-syntax","version":"0.8.11","url":"https://static.crates.io/crates/regex-syntax/regex-syntax-0.8.11.crate","sha256":"d6f6ff9a378485b298a5286656da665ba74413d36db0979633275d2e708145d4","files":[{"path":"regex-syntax-0.8.11/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"regex-syntax-0.8.11/LICENSE-MIT","sha256":"6485b8ed310d3f0340bf1ad1f47645069ce4069dcc6bb46c7d5c6faf41de1fdb"},{"path":"regex-syntax-0.8.11/src/unicode_tables/LICENSE-UNICODE","sha256":"74db5baf44a41b1000312c673544b3374e4198af5605c7f9080a402cec42cfa3"}]},
  {"name":"rgb","version":"0.8.53","url":"https://static.crates.io/crates/rgb/rgb-0.8.53.crate","sha256":"47b34b781b31e5d73e9fbc8689c70551fd1ade9a19e3e28cfec8580a79290cc4","files":[{"path":"rgb-0.8.53/LICENSE","sha256":"457b464bc0fba8a3d67d2458569104f5611869f0c1563a1a12d9c51a0bca9261"}]},
  {"name":"rustc-hash","version":"2.1.3","url":"https://static.crates.io/crates/rustc-hash/rustc-hash-2.1.3.crate","sha256":"6b1e7f9a428571be2dc5bc0505c13fb6bf936822b894ec87abf8a08a4e51742d","files":[{"path":"rustc-hash-2.1.3/LICENSE-APACHE","sha256":"95bd3988beee069fa2848f648dab43cc6e0b2add2ad6bcb17360caf749802bcc"},{"path":"rustc-hash-2.1.3/LICENSE-MIT","sha256":"30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652"}]},
  {"name":"rustversion","version":"1.0.23","url":"https://static.crates.io/crates/rustversion/rustversion-1.0.23.crate","sha256":"cf54715a573b99ac80df0bc206da022bcd442c974952c7b9720069370852e21f","files":[{"path":"rustversion-1.0.23/LICENSE-APACHE","sha256":"62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a"},{"path":"rustversion-1.0.23/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"serde","version":"1.0.229","url":"https://static.crates.io/crates/serde/serde-1.0.229.crate","sha256":"4148590afebada386688f18773da617792bf2ef03ffc1e4cbd2b1d45b023e0ba","files":[{"path":"serde-1.0.229/LICENSE-APACHE","sha256":"62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a"},{"path":"serde-1.0.229/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"serde_core","version":"1.0.229","url":"https://static.crates.io/crates/serde_core/serde_core-1.0.229.crate","sha256":"67dca2c9c51e58a4791a4b1ed58308b39c64224d349a935ab5039aa360942a48","files":[{"path":"serde_core-1.0.229/LICENSE-APACHE","sha256":"62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a"},{"path":"serde_core-1.0.229/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"serde_derive","version":"1.0.229","url":"https://static.crates.io/crates/serde_derive/serde_derive-1.0.229.crate","sha256":"e7a5d71263a5a7d47b41f6b3f06ba276f10cc18b0931f1799f710578e2309348","files":[{"path":"serde_derive-1.0.229/LICENSE-APACHE","sha256":"62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a"},{"path":"serde_derive-1.0.229/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"serde_json","version":"1.0.151","url":"https://static.crates.io/crates/serde_json/serde_json-1.0.151.crate","sha256":"c841b55ecdae098c80dcae9cf767f6f8a0c2cdb3416bbef72181df4d0fe73f14","files":[{"path":"serde_json-1.0.151/LICENSE-APACHE","sha256":"62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a"},{"path":"serde_json-1.0.151/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"shlex","version":"2.0.1","url":"https://static.crates.io/crates/shlex/shlex-2.0.1.crate","sha256":"f8fadd59c855ef2080decdef8ff161eb6661b86933c9d82e5ba29dc602a55aba","files":[{"path":"shlex-2.0.1/LICENSE-APACHE","sha256":"553fffcd9b1cb158bc3e9edc35da85ca5c3b3d7d2e61c883ebcfa8a65814b583"},{"path":"shlex-2.0.1/LICENSE-MIT","sha256":"4455bf75a91154108304cb283e0fea9948c14f13e20d60887cf2552449dea3b1"}]},
  {"name":"siphasher","version":"1.0.3","url":"https://static.crates.io/crates/siphasher/siphasher-1.0.3.crate","sha256":"8ee5873ec9cce0195efcb7a4e9507a04cd49aec9c83d0389df45b1ef7ba2e649","files":[{"path":"siphasher-1.0.3/COPYING","sha256":"c962ee4d1d05ddc138b202b2540219ebc57893fcf97b364852094a9a94ce1365"}]},
  {"name":"slab","version":"0.4.12","url":"https://static.crates.io/crates/slab/slab-0.4.12.crate","sha256":"0c790de23124f9ab44544d7ac05d60440adc586479ce501c1d6d7da3cd8c9cf5","files":[{"path":"slab-0.4.12/LICENSE","sha256":"8ce0830173fdac609dfb4ea603fdc002c2f4af0dc9b1a005653f5da9cf534b18"}]},
  {"name":"smallvec","version":"1.15.2","url":"https://static.crates.io/crates/smallvec/smallvec-1.15.2.crate","sha256":"8ed6a63f02c8539c91a8685a86f4099661ba3da017932f6ebbea6de3f0fa7c90","files":[{"path":"smallvec-1.15.2/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"smallvec-1.15.2/LICENSE-MIT","sha256":"0b28172679e0009b655da42797c03fd163a3379d5cfa67ba1f1655e974a2a1a9"}]},
  {"name":"syn","version":"2.0.119","url":"https://static.crates.io/crates/syn/syn-2.0.119.crate","sha256":"872831b642d1a07999a962a351ed35b955ea2cfc8f3862091e2a240a84f17297","files":[{"path":"syn-2.0.119/LICENSE-APACHE","sha256":"62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a"},{"path":"syn-2.0.119/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"syn","version":"3.0.3","url":"https://static.crates.io/crates/syn/syn-3.0.3.crate","sha256":"53e9bae58849f64dfa4f5d5ae372c8341f7305f82a3868709269343628b659a3","files":[{"path":"syn-3.0.3/LICENSE-APACHE","sha256":"62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a"},{"path":"syn-3.0.3/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"thiserror","version":"2.0.19","url":"https://static.crates.io/crates/thiserror/thiserror-2.0.19.crate","sha256":"09a43598840e33d5b0331f38c5e30d13bb11c11210a4b58f0d9b18a5a5eefcd9","files":[{"path":"thiserror-2.0.19/LICENSE-APACHE","sha256":"62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a"},{"path":"thiserror-2.0.19/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"thiserror-impl","version":"2.0.19","url":"https://static.crates.io/crates/thiserror-impl/thiserror-impl-2.0.19.crate","sha256":"43cbfe0cf76104d42a574802844187e84a305e531ed54455f11fbde0f10541cd","files":[{"path":"thiserror-impl-2.0.19/LICENSE-APACHE","sha256":"62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a"},{"path":"thiserror-impl-2.0.19/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
  {"name":"tokio","version":"1.53.1","url":"https://static.crates.io/crates/tokio/tokio-1.53.1.crate","sha256":"202caea871b69668250d242070849eb495be178ed697a3e98aebce5bc81a0bed","files":[{"path":"tokio-1.53.1/LICENSE","sha256":"253cd04c6714889df2d32f3f64d669179a1c95c76ac43c40882c52eb06bc3552"}]},
  {"name":"tokio-stream","version":"0.1.19","url":"https://static.crates.io/crates/tokio-stream/tokio-stream-0.1.19.crate","sha256":"a3d06f0b082ba57c26b79407372e57cf2a1e28124f78e9479fe80322cf53420b","files":[{"path":"tokio-stream-0.1.19/LICENSE","sha256":"253cd04c6714889df2d32f3f64d669179a1c95c76ac43c40882c52eb06bc3552"}]},
  {"name":"unicode-ident","version":"1.0.24","url":"https://static.crates.io/crates/unicode-ident/unicode-ident-1.0.24.crate","sha256":"e6e4313cd5fcd3dad5cafa179702e2b244f760991f45397d14d4ebf38247da75","files":[{"path":"unicode-ident-1.0.24/LICENSE-APACHE","sha256":"62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a"},{"path":"unicode-ident-1.0.24/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"},{"path":"unicode-ident-1.0.24/LICENSE-UNICODE","sha256":"f7db81051789b729fea528a63ec4c938fdcb93d9d61d97dc8cc2e9df6d47f2a1"}]},
  {"name":"unicode-segmentation","version":"1.13.3","url":"https://static.crates.io/crates/unicode-segmentation/unicode-segmentation-1.13.3.crate","sha256":"c6f5d3c3b1bf09027a88a6bc961fc00497d651009560b5463668dc81b0fa87a8","files":[{"path":"unicode-segmentation-1.13.3/COPYRIGHT","sha256":"23860c2a7b5d96b21569afedf033469bab9fe14a1b24a35068b8641c578ce24d"},{"path":"unicode-segmentation-1.13.3/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"unicode-segmentation-1.13.3/LICENSE-MIT","sha256":"7b63ecd5f1902af1b63729947373683c32745c16a10e8e6292e2e2dcd7e90ae0"}]},
  {"name":"uuid","version":"1.24.0","url":"https://static.crates.io/crates/uuid/uuid-1.24.0.crate","sha256":"bf3923a6f5c4c6382e0b653c4117f48d631ea17f38ed86e2a828e6f7412f5239","files":[{"path":"uuid-1.24.0/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"uuid-1.24.0/LICENSE-MIT","sha256":"436bc5a105d8e57dcd8778730f3754f7bf39c14d2f530e4cde4bd2d17a83ec3d"}]},
  {"name":"wasm-bindgen","version":"0.2.126","url":"https://static.crates.io/crates/wasm-bindgen/wasm-bindgen-0.2.126.crate","sha256":"4b067c0c11094aef6b7a801c1e34a26affafdf3d051dba08456b868789aaf9a4","files":[{"path":"wasm-bindgen-0.2.126/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"wasm-bindgen-0.2.126/LICENSE-MIT","sha256":"378f5840b258e2779c39418f3f2d7b2ba96f1c7917dd6be0713f88305dbda397"}]},
  {"name":"wasm-bindgen-macro","version":"0.2.126","url":"https://static.crates.io/crates/wasm-bindgen-macro/wasm-bindgen-macro-0.2.126.crate","sha256":"167ce5e579f6bcf889c4f7175a8a5a585de84e8ff93976ce393efa5f2837aab1","files":[{"path":"wasm-bindgen-macro-0.2.126/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"wasm-bindgen-macro-0.2.126/LICENSE-MIT","sha256":"378f5840b258e2779c39418f3f2d7b2ba96f1c7917dd6be0713f88305dbda397"}]},
  {"name":"wasm-bindgen-macro-support","version":"0.2.126","url":"https://static.crates.io/crates/wasm-bindgen-macro-support/wasm-bindgen-macro-support-0.2.126.crate","sha256":"f3997c7839262f4ef12cf90b818d6340c18e80f263f1a94bf157d0ec4420380e","files":[{"path":"wasm-bindgen-macro-support-0.2.126/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"wasm-bindgen-macro-support-0.2.126/LICENSE-MIT","sha256":"378f5840b258e2779c39418f3f2d7b2ba96f1c7917dd6be0713f88305dbda397"}]},
  {"name":"wasm-bindgen-shared","version":"0.2.126","url":"https://static.crates.io/crates/wasm-bindgen-shared/wasm-bindgen-shared-0.2.126.crate","sha256":"dc1b4cb0cc549fcf58d7dfc081778139b3d283a081644e833e84682ad71cea24","files":[{"path":"wasm-bindgen-shared-0.2.126/LICENSE-APACHE","sha256":"a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2"},{"path":"wasm-bindgen-shared-0.2.126/LICENSE-MIT","sha256":"378f5840b258e2779c39418f3f2d7b2ba96f1c7917dd6be0713f88305dbda397"}]},
  {"name":"web-time","version":"1.1.0","url":"https://static.crates.io/crates/web-time/web-time-1.1.0.crate","sha256":"5a6580f308b1fad9207618087a65c04e7a10bc77e02c8e84e9b00dd4b12fa0bb","files":[{"path":"web-time-1.1.0/LICENSE-APACHE","sha256":"54a744942eb3fa63a74d8d359989ed6962c04f3f10ff20cfa08ff8aa7efbe4e6"},{"path":"web-time-1.1.0/LICENSE-MIT","sha256":"f428305bbf2e70fbd807af0f3c7ac1b7acfb95311640f451e9d2e48db6d7e96b"}]},
  {"name":"weezl","version":"0.1.12","url":"https://static.crates.io/crates/weezl/weezl-0.1.12.crate","sha256":"a28ac98ddc8b9274cb41bb4d9d4d5c425b6020c50c46f25559911905610b4a88","files":[{"path":"weezl-0.1.12/LICENSE-APACHE","sha256":"769f80b5bcb42ed0af4e4d2fd74e1ac9bf843cb80c5a29219d1ef3544428a6bb"},{"path":"weezl-0.1.12/LICENSE-MIT","sha256":"573f5227db835cd30bbdd3aed3f82615f80119a4d5c82b4daf642dbfe2b6afde"}]},
  {"name":"windows-link","version":"0.2.1","url":"https://static.crates.io/crates/windows-link/windows-link-0.2.1.crate","sha256":"f0805222e57f7521d6a62e36fa9163bc891acd422f971defe97d64e70d0a4fe5","files":[{"path":"windows-link-0.2.1/license-apache-2.0","sha256":"c16f8dcf1a368b83be78d826ea23de4079fe1b4469a0ab9ee20563f37ff3d44b"},{"path":"windows-link-0.2.1/license-mit","sha256":"c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383"}]},
  {"name":"zmij","version":"1.0.23","url":"https://static.crates.io/crates/zmij/zmij-1.0.23.crate","sha256":"29666d0abbfad1e3dc4dcf6144730dd3a3ab225bbbdac83319345b1b44ccfc1b","files":[{"path":"zmij-1.0.23/LICENSE-MIT","sha256":"23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3"}]},
]);
const dependencyPath = /^(?:node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9_-][a-z0-9._-]*)(?:\/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9_-][a-z0-9._-]*)*$/;
const packageName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9_-][a-z0-9._-]*$/;
const noticeName = /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i;
const personalPath = /(?:^|\/)(?:\.git|\.aws|\.ssh|\.env[^/]*|user[-_]?data|backups|credentials?|tokens?)(?:\/|$)|\.(?:sqlite3?|db|pem|key|p12|pfx)(?:-wal|-shm)?$/i;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sortedEntries = value => JSON.stringify(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));

export function assertWindowsHost({ platform = process.platform, arch = process.arch, node = process.versions.node } = {}) {
  if (platform !== 'win32') throw new Error('Windows is required to package this app.');
  if (arch !== 'x64') throw new Error('Windows x64 is required to package this app.');
  if (node.split('.')[0] !== '24') throw new Error('Node 24 is required.');
}
export async function createPackageWorkspace(parent) {
  await mkdir(parent, { recursive: true });
  const output = await mkdtemp(join(parent, 'unsigned-'));
  const temporary = await mkdtemp(join(parent, 'stage-'));
  return { output, temporary };
}
export function validateOriginalNotice(source, bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 2_000_000 || bytes.includes(0)
    || !/^[a-f0-9]{64}$/.test(source.sha256) || sha256(bytes) !== source.sha256) throw new Error(`Original notice hash/content mismatch: ${source.id ?? source.path}`);
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export async function stageNativeNotices({ root, licenses, documents, rustDocuments }) {
  const sbomPath = 'node_modules/@napi-rs/canvas-win32-x64-msvc/sbom.cdx.json'; await regular(root, sbomPath);
  const sbomBytes = await readFile(join(root, sbomPath));
  if (sha256(sbomBytes) !== CANVAS_SBOM_SHA256) throw new Error('Pinned Windows canvas SBOM hash mismatch; review native notices for this binary version.');
  const sbom = JSON.parse(sbomBytes), records = [];
  await put(join(licenses, 'native/canvas-sbom.cdx.json'), sbomBytes);
  for (const source of NATIVE_NOTICE_SOURCES) {
    const bytes = documents.get(source.id); validateOriginalNotice(source, bytes);
    const path = `native/originals/${source.id}`; safeRelative(`licenses/${path}`);
    await put(join(licenses, path), bytes); records.push({ ...source, path });
  }
  for (const archive of RUST_NOTICE_ARCHIVES) {
    const component = sbom.components.find(item => item.name === archive.name && item.version === archive.version && item.purl?.startsWith('pkg:cargo/'));
    if (!component?.hashes?.some(item => item.alg === 'SHA-256' && item.content === archive.sha256)) throw new Error(`Rust notice archive differs from native SBOM: ${archive.name}`);
    const originals = rustDocuments.get(archive.name + '@' + archive.version);
    if (!Array.isArray(originals) || originals.length !== archive.files.length) throw new Error(`Rust notice documents missing: ${archive.name}`);
    for (const [index, file] of archive.files.entries()) {
      const original = originals.find(item => item.path === file.path);
      if (!original) throw new Error(`Rust original notice missing: ${file.path}`);
      validateOriginalNotice(file, original.bytes);
      const path = `native/rust/${archive.name}-${archive.version}/${index}-${posix.basename(file.path)}`; safeRelative(`licenses/${path}`);
      await put(join(licenses, path), original.bytes);
      records.push({ component: archive.name, version: archive.version, url: archive.url, archiveSha256: archive.sha256, originalPath: file.path, sha256: file.sha256, path });
    }
  }
  const notes = [
    '# Native / WebAssembly original notices', '',
    'This software uses the FreeType Project (https://www.freetype.org/). FreeType is used under the FreeType License option; its original FTL text and upstream dual-license information are included.',
    'This software is based in part on the work of the Independent JPEG Group.', '',
    'Evidence: the exact Windows canvas 1.0.11 SBOM and source tag, plus Tesseract.js-core 7.0.0 source submodule revisions. Original documents and their immutable source URLs/SHA256 values are preserved in inventory.json.',
    'The SBOM can contain build dependencies and platform-specific alternatives. Inclusion of a notice does not assert that every listed component is linked into this Windows binary.',
    'The canvas workspace crate uses the canvas root MIT text. Crates without license files in their published archive use the matching source workspace texts: base64-simd/vsimd (Nugine/simd d74c030d), napi/napi-build/napi-derive/napi-derive-backend (napi-rs 956e4525), napi-sys (napi-rs 679eb79f). These revisions were read from each published crate cargo_vcs_info file.', '',
    'This inventory records the original notices actually obtained. It is not a legal clearance or a claim of exhaustive binary attribution. Build-specific linking, per-file/subdirectory notices and redistribution obligations still require review before a general public release.', '',
  ];
  await put(join(licenses, 'native/README.md'), notes.join('\n'));
  const coverage = { format: 1, canvasSbomSha256: CANVAS_SBOM_SHA256, canvasSourceCommit: 'adce718ec8ff82f9e896875752fd621c46b1c04e', tesseractCoreSourceCommit: 'acffef2b66eb44a31df297e11d905f4b39001068', originalDocuments: records.length, rustSourceArchives: RUST_NOTICE_ARCHIVES.length, legalClearanceAsserted: false, scope: 'Pinned upstream SBOM/source documents; see README.md for scope and remaining review', documents: records };
  await put(join(licenses, 'native/inventory.json'), JSON.stringify(coverage, null, 2) + '\n');
  return { canvasSbomSha256: CANVAS_SBOM_SHA256, originalDocuments: records.length, rustSourceArchives: RUST_NOTICE_ARCHIVES.length, legalClearanceAsserted: false };
}
export function verifyAppArchive(entries) {
  const files = entries.map(path => path.replaceAll('\\', '/'));
  for (const path of ['/package.json', '/dist/index.html', '/dist-electron/electron/main.js', '/dist-electron/electron/preload.cjs']) {
    if (!files.includes(path)) throw new Error(`Packaged app is missing ${path}`);
  }
  if (files.some(path => /(?:^|\/)(?:docs|tests|artifacts|\.git|\.env[^/]*|user[-_]?data)(?:\/|$)|\.(?:sqlite3?|db)(?:-wal|-shm)?$/i.test(path))) throw new Error('Unexpected private/source file in app.asar.');
  return files;
}

function safeRelative(path) {
  if (!path || path.length > 150) throw new Error(`Package relative path exceeds 150 characters: ${path}`);
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..' || /[<>:"\\|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) throw new Error(`Unsafe Windows package path: ${path}`);
  }
  if (personalPath.test(path)) throw new Error(`Personal data is not a package resource: ${path}`);
}
async function regular(root, path, directory = false) {
  safeRelative(path);
  let current = root;
  const parts = path.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    const info = await lstat(current).catch(error => { if (error.code === 'ENOENT') throw new Error(`Missing package resource: ${path}`); throw error; });
    if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`);
    if (index < parts.length - 1 || directory) {
      if (!info.isDirectory()) throw new Error(`Not a directory: ${path}`);
    } else if (!info.isFile()) throw new Error(`Not a regular file: ${path}`);
  }
}
async function put(path, bytes) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); }
async function copy(root, path, destination, outputPath, dependencies = false) {
  safeRelative(outputPath);
  const info = await lstat(join(root, path));
  if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`);
  if (info.isDirectory()) {
    for (const name of (await readdir(join(root, path))).sort()) {
      if (name.startsWith('.') || (dependencies && name === 'node_modules')) continue;
      await copy(root, `${path}/${name}`, join(destination, name), `${outputPath}/${name}`, dependencies);
    }
  } else {
    await regular(root, path); await mkdir(dirname(destination), { recursive: true }); await copyFile(join(root, path), destination);
  }
}
function compatible(record, platform, arch) {
  const matches = (values, value) => !values?.length || (!values.includes('!' + value) && (!values.some(item => !item.startsWith('!')) || values.includes(value) || values.includes('any')));
  return matches(record.os, platform) && matches(record.cpu, arch);
}
function lockInfo(lock) {
  if (lock.lockfileVersion !== 3 || !lock.packages?.['']) throw new Error('package-lock.json v3 required. Run npm ci.');
  for (const [path, record] of Object.entries(lock.packages)) {
    if (path && (!dependencyPath.test(path) || record.link)) throw new Error(`Invalid production dependency path: ${path}`);
  }
}

/** Follow the lock's Node resolution graph, not every non-dev/optional record in the lock. */
export async function collectDependencies({ root, lock, seeds, platform = 'win32', arch = 'x64' }) {
  lockInfo(lock);
  const selected = new Map();
  const resolve = (name, from) => {
    if (!packageName.test(name)) throw new Error(`Invalid dependency name: ${name}`);
    let parent = from;
    while (parent) {
      const candidate = `${parent}/node_modules/${name}`;
      if (lock.packages[candidate]) return candidate;
      parent = posix.dirname(parent);
      if (parent === '.') break;
    }
    const top = `node_modules/${name}`;
    if (!lock.packages[top]) throw new Error(`Locked dependency missing: ${name}`);
    return top;
  };
  async function visit(name, from = '', optional = false) {
    const path = resolve(name, from), record = lock.packages[path];
    if (!compatible(record, platform, arch)) {
      if (optional) return;
      throw new Error(`Dependency platform mismatch: ${path}`);
    }
    if (selected.has(path)) return;
    await regular(root, path, true); await regular(root, `${path}/package.json`);
    const installed = JSON.parse(await readFile(join(root, path, 'package.json'), 'utf8'));
    if (installed.name !== name || installed.version !== record.version) throw new Error(`${path} version/name mismatch; run npm ci.`);
    if (!compatible(installed, platform, arch)) throw new Error(`Installed dependency platform mismatch: ${path}`);
    for (const field of ['dependencies', 'optionalDependencies']) {
      if (sortedEntries(installed[field]) !== sortedEntries(record[field])) throw new Error(`Installed dependency graph differs from lock: ${path}`);
    }
    selected.set(path, { path, name, version: record.version, license: installed.license ?? record.license ?? 'SEE ORIGINAL NOTICE' });
    for (const dependency of Object.keys(record.dependencies ?? {})) if (!(dependency in (record.optionalDependencies ?? {}))) await visit(dependency, path);
    for (const dependency of Object.keys(record.optionalDependencies ?? {})) await visit(dependency, path, true);
  }
  for (const seed of seeds) await visit(seed);
  return [...selected.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function compiled(root, source) {
  await regular(root, source, true);
  const outputs = [];
  for (const name of (await readdir(join(root, source))).sort()) {
    const path = `${source}/${name}`, info = await lstat(join(root, path));
    if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`);
    if (info.isDirectory()) outputs.push(...await compiled(root, path));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) outputs.push(`dist-electron/${path.slice(0, -3)}.js`);
  }
  return outputs;
}

/** Parse import and delay-import tables instead of trusting the runner's installed VC++ runtime. */
export function peImports(bytes) {
  try {
    if (bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error();
    const header = bytes.readUInt32LE(60);
    if (bytes.toString('ascii', header, header + 4) !== 'PE\0\0' || bytes.readUInt16LE(header + 4) !== 0x8664) throw new Error();
    const count = bytes.readUInt16LE(header + 6), size = bytes.readUInt16LE(header + 20), optional = header + 24;
    if (bytes.readUInt16LE(optional) !== 0x20b || count > 96 || size < 112) throw new Error();
    const directories = bytes.readUInt32LE(optional + 108), sections = optional + size;
    const offset = rva => {
      for (let index = 0; index < count; index++) {
        const section = sections + index * 40, start = bytes.readUInt32LE(section + 12), length = bytes.readUInt32LE(section + 16);
        if (rva >= start && rva < start + length) {
          const result = bytes.readUInt32LE(section + 20) + rva - start;
          if (result >= bytes.length) throw new Error();
          return result;
        }
      }
      throw new Error();
    };
    const names = new Set();
    for (const [entry, width, nameOffset] of [[1, 20, 12], [13, 32, 4]]) {
      if (directories <= entry || size < 112 + (entry + 1) * 8) continue;
      const rva = bytes.readUInt32LE(optional + 112 + entry * 8), length = bytes.readUInt32LE(optional + 116 + entry * 8);
      if (!rva || !length) continue;
      const start = offset(rva);
      let terminated = false;
      for (let cursor = start; cursor < start + length; cursor += width) {
        const row = bytes.subarray(cursor, cursor + width);
        if (row.length !== width) throw new Error();
        if (row.every(value => value === 0)) { terminated = true; break; }
        if (entry === 13 && !(bytes.readUInt32LE(cursor) & 1)) throw new Error();
        const nameStart = offset(bytes.readUInt32LE(cursor + nameOffset)), end = bytes.indexOf(0, nameStart);
        if (end < nameStart || end - nameStart > 255) throw new Error();
        const name = bytes.toString('ascii', nameStart, end).toLowerCase();
        if (!/^[a-z0-9._-]+\.(?:dll|drv)$/.test(name)) throw new Error();
        names.add(name);
      }
      if (!terminated) throw new Error();
    }
    return [...names].sort();
  } catch { throw new Error('Invalid or unsupported Windows x64 PE image.'); }
}
const systemDlls = new Set('kernel32 kernelbase ntdll user32 advapi32 ole32 oleaut32 gdi32 gdi32full ws2_32 bcrypt bcryptprimitives crypt32 shell32 shlwapi version winmm imm32 dwrite d3d11 d3d12 dxgi rpcrt4 setupapi secur32 dbghelp opengl32 ucrtbase msvcrt comdlg32 powerprof iphlpapi normaliz psapi propsys winhttp dnsapi wtsapi32 mscoree comctl32 wintrust usp10 msimg32 cfgmgr32 dwmapi dcomp shcore userenv hid netapi32 ncrypt cryptbase avrt mswsock profapi powrprof uxtheme wininet'.split(' ').map(name => name + '.dll'));
systemDlls.add('winspool.drv');
export async function resourceInventory(root, prefix = '') {
  const files = [];
  for (const name of (await readdir(root)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name; safeRelative(path);
    const info = await lstat(join(root, name));
    if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`);
    if (info.isDirectory()) files.push(...await resourceInventory(join(root, name), path));
    else if (info.isFile()) {
      const bytes = await readFile(join(root, name));
      files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
    } else throw new Error(`Unsupported resource: ${path}`);
  }
  return files;
}
async function nativeInventory(root, prefix) {
  const files = await resourceInventory(root, prefix), imports = [];
  for (const file of files.filter(file => /\.(?:node|dll|exe)$/i.test(file.path))) {
    const local = file.path.slice(prefix.length + 1), dependencies = peImports(await readFile(join(root, local)));
    for (const dependency of dependencies) {
      if (systemDlls.has(dependency) || /^(?:api|ext)-ms-win-/.test(dependency)) continue;
      const candidate = posix.join(posix.dirname(file.path), dependency);
      if (!files.some(item => item.path.toLowerCase() === candidate.toLowerCase())) throw new Error(`Unbundled native DLL dependency: ${file.path} requires ${dependency}. Verify redistribution rights before adding a DLL.`);
    }
    imports.push({ path: file.path, imports: dependencies });
  }
  return imports;
}
async function noticeFiles(root, path, relative = '') {
  const files = [];
  for (const name of (await readdir(join(root, path, relative))).sort()) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const target = relative ? `${relative}/${name}` : name;
    const info = await lstat(join(root, path, target));
    if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}/${target}`);
    if (info.isDirectory()) files.push(...await noticeFiles(root, path, target));
    else if (noticeName.test(name)) files.push(target);
  }
  return files;
}
async function stageNotices(root, packages, licenses, tessdataLicense, tr46License) {
  const records = [], markdown = ['# Windows bundled npm license and notice texts', ''];
  for (const item of packages) {
    const names = await noticeFiles(root, item.path), originals = [];
    for (const name of names) {
      await regular(root, `${item.path}/${name}`);
      const bytes = await readFile(join(root, item.path, name));
      if (bytes.includes(0) || bytes.length > 2_000_000) throw new Error(`Invalid license text: ${item.path}/${name}`);
      originals.push({ name, bytes, source: `${item.path}/${name}` });
    }
    if (!originals.length && item.name === '@napi-rs/canvas-win32-x64-msvc') {
      const source = 'node_modules/@napi-rs/canvas/LICENSE'; await regular(root, source);
      originals.push({ name: 'LICENSE', bytes: await readFile(join(root, source)), source });
    }
    if (/^@tesseract\.js-data\/(?:eng|kor)$/.test(item.name) && tessdataLicense) {
      if (sha256(tessdataLicense) !== TESSDATA_LICENSE.sha256) throw new Error('Tessdata original license hash mismatch.');
      originals.push({ name: 'UPSTREAM-TESSDATA-LICENSE', bytes: tessdataLicense, source: TESSDATA_LICENSE.url });
    }
    if (!originals.length && item.name === 'tr46' && item.version === '0.0.3' && tr46License) {
      if (sha256(tr46License) !== TR46_LICENSE.sha256) throw new Error('tr46 original license hash mismatch.');
      originals.push({ name: 'UPSTREAM-LICENSE.md', bytes: tr46License, source: TR46_LICENSE.url });
    }
    if (!originals.length) throw new Error(`Original license text missing: ${item.name}`);
    const key = item.path.replaceAll('node_modules/', '').replaceAll('/', '__');
    const files = [];
    await put(join(licenses, 'npm', key, 'package.json'), await readFile(join(root, item.path, 'package.json')));
    markdown.push(`## ${item.name} ${item.version}`, '', `Declared package license: ${item.license}`, '');
    for (const original of originals) {
      const path = `npm/${key}/${original.name}`; safeRelative(`licenses/${path}`);
      await put(join(licenses, path), original.bytes);
      markdown.push(`### ${original.name}`, '', `Source: ${original.source}`, '', original.bytes.toString('utf8').trimEnd(), '');
      files.push({ path, source: original.source, sha256: sha256(original.bytes) });
    }
    records.push({ ...item, files });
  }
  await put(join(licenses, 'npm-notices.md'), markdown.join('\n'));
  await put(join(licenses, 'npm-inventory.json'), JSON.stringify(records, null, 2) + '\n');
}

export async function stageWindowsApp({ root, stage, pdfRuntime, native, licenses, tessdataLicense, tr46License }) {
  await regular(root, 'package.json'); await regular(root, 'package-lock.json');
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')); lockInfo(lock);
  if (metadata.name !== 'swallow' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(metadata.version)
    || metadata.main !== 'dist-electron/electron/main.js' || metadata.type !== 'module' || metadata.license !== 'MIT') throw new Error('Invalid Swallow package metadata.');
  for (const [name, version] of Object.entries(PDF_PACKAGES)) {
    if (metadata.devDependencies?.[name] !== version) throw new Error(`${name} must be pinned to ${version}.`);
  }
  if (lock.packages[''].version !== metadata.version
    || sortedEntries(lock.packages[''].dependencies) !== sortedEntries(metadata.dependencies)) throw new Error('Root metadata differs from package-lock.json.');
  const dependencies = await collectDependencies({ root, lock, seeds: Object.keys(metadata.dependencies ?? {}) });
  const pdfDependencies = await collectDependencies({ root, lock, seeds: Object.keys(PDF_PACKAGES) });
  for (const [name, version] of Object.entries(PDF_PACKAGES)) {
    if (!pdfDependencies.some(item => item.path === `node_modules/${name}` && item.version === version)) throw new Error(`${name} locked version mismatch; expected ${version}.`);
  }
  if (!pdfDependencies.some(item => item.name === '@napi-rs/canvas-win32-x64-msvc' && item.version === PDF_PACKAGES['@napi-rs/canvas'])) throw new Error('Required @napi-rs/canvas-win32-x64-msvc missing from PDF runtime.');
  const renderer = new Set(['index.html']); await regular(root, 'dist/index.html');
  const html = await readFile(join(root, 'dist/index.html'), 'utf8');
  for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const reference = tag[0].match(/\b(?:src|href)=["']([^"']+)["']/i)?.[1]; if (!reference) continue;
    const path = reference.replace(/^\.\//, '');
    if (!/^assets\/[a-zA-Z0-9_-]+\.(?:js|css)$/.test(path)) throw new Error(`Invalid renderer asset: ${reference}`);
    renderer.add(path);
  }
  for (const path of renderer) { await regular(root, `dist/${path}`); await copy(root, `dist/${path}`, join(stage, 'dist', path), `dist/${path}`); }
  const outputs = ['dist-electron/electron/preload.cjs', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
  for (const source of ['electron', 'src/shared', 'src/learning']) outputs.push(...await compiled(root, source));
  for (const path of outputs) { await regular(root, path); await copy(root, path, join(stage, path), path); }
  for (const item of dependencies) await copy(root, item.path, join(stage, item.path), item.path, true);
  const { name, version, type, main, license } = metadata;
  await put(join(stage, 'package.json'), JSON.stringify({ name, version, type, main, license }, null, 2) + '\n');
  for (const name of ['worker.mjs', 'runtime.mjs']) {
    const path = `dist-electron/native/pdf-runtime/${name}`; await regular(root, path);
    await copy(root, path, join(pdfRuntime, name), `pdf-runtime/${name}`);
  }
  for (const item of pdfDependencies.filter(item => !item.name.startsWith('@tesseract.js-data/'))) await copy(root, item.path, join(pdfRuntime, item.path), `pdf-runtime/${item.path}`, true);
  for (const lang of ['eng', 'kor']) {
    const path = `node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`; await regular(root, path);
    const bytes = await readFile(join(root, path));
    if (bytes[0] !== 31 || bytes[1] !== 139) throw new Error(`Invalid compressed OCR language resource: ${lang}`);
    const prepared = `dist-electron/native/pdf-runtime/tessdata/${lang}.traineddata.gz`; await regular(root, prepared);
    if (sha256(await readFile(join(root, prepared))) !== sha256(bytes)) throw new Error(`Prepared OCR language resource differs from locked package: ${lang}`);
    await copy(root, prepared, join(pdfRuntime, 'tessdata', `${lang}.traineddata.gz`), `pdf-runtime/tessdata/${lang}.traineddata.gz`);
  }
  for (const path of ['node_modules/pdfjs-dist/legacy/build/pdf.mjs', 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', 'node_modules/tesseract.js/src/worker-script/node/index.js', 'node_modules/tesseract.js-core/tesseract-core.wasm.js', 'node_modules/tesseract.js-core/tesseract-core.wasm', 'node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node']) await regular(pdfRuntime, path);
  for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
    await regular(pdfRuntime, `node_modules/pdfjs-dist/${directory}`, true);
    if (!(await readdir(join(pdfRuntime, 'node_modules/pdfjs-dist', directory))).length) throw new Error(`Empty PDF resource: ${directory}`);
  }
  await regular(root, 'dist-electron/native/swallow-speech.exe');
  await copy(root, 'dist-electron/native/swallow-speech.exe', join(native, 'swallow-speech.exe'), 'native/swallow-speech.exe');
  const allPackages = [...new Map([...dependencies, ...pdfDependencies].map(item => [item.path, item])).values()];
  await stageNotices(root, allPackages, licenses, tessdataLicense, tr46License);
  const nativeImports = [...await nativeInventory(pdfRuntime, 'pdf-runtime'), ...await nativeInventory(native, 'native')];
  const resources = [...await resourceInventory(pdfRuntime, 'pdf-runtime'), ...await resourceInventory(native, 'native'), ...await resourceInventory(licenses, 'licenses')];
  return { version, dependencies, pdfDependencies, nativeImports, resources };
}
