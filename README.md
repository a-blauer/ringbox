# RingBox

A ManaBox-style companion app for Decipher's **Lord of the Rings TCG**: card search, collection binders, deck builder with rules checking, and a camera card scanner. It's a static web app that installs to your phone's home screen and works offline.

- **Search**: every card (3,325 printed and virtual, plus PC errata), filters, and query syntax (`tw<=2 cu:elven t:companion`, `f:pc-movie`, `is:owned`)
- **Collection**: binders, wishlist and trade lists, foils, set completion, CSV import/export
- **Decks**: Ring-bearer, Ring, 9-site adventure deck, draw deck; checks 60 cards, FP = Shadow, Rule of 4, site paths, X/R-lists per format; twilight curve, culture stats, test hands with draw odds, missing cards to wishlist
- **Scanner**: on-device OCR of the title and collector number (e.g. `1R89`); live camera or photo
- Data stays on your device; back up from More

Card data and images: [LOTR TCG Player's Council](https://github.com/PlayersCouncil/lotrtcg-card-data). The game is © Decipher Inc. and Middle-earth Enterprises; this is an unofficial fan tool. OCR: [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache 2.0), bundled in `vendor/`.

To refresh card data: run `build/make_data.py <lotrtcg-card-data/data> data`.
