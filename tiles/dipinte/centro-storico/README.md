# PNG del centro storico

Metti qui le tile dipinte a mano, o generate fuori dalla pipeline, e il build di GitHub Pages ricostruisce la piramide al posto dello schema in `web/tiles/centro-storico/`.

- Formato: PNG, **1024×1024** pixel.
- Nome: quello delle tile di render, `tx_ty.png`. Esempio: `-1_-2.png` è la tile della Rocca.
- Una cartella vuota (solo questo file) non cambia nulla: il sito pubblica lo schema versionato.
- Il build usa sharp. Non scarica DBGT o DEM e non avvia Chromium.
- `world.json` della piramide pubblicata avrà `dipinte: true`.

Per sostituire lo schema con un export già fatto in locale (`npm run export` o `npm run export -- --dipinte`), dopo aver controllato `data/web/regions/subiaco/`:

```bash
npm run build -- --aggiorna-tile
```

Il comando copia quella piramide in `web/tiles/centro-storico/`, aggiunge il JPEG accanto a ogni AVIF e si ferma se il totale supera 50 MB. Poi va committata la cartella.
