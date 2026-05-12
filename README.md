# Private Drive Stremio Add-on

Add-on privato per Stremio che mostra un catalogo di video personali salvati su Google Drive.

## Requisiti

- Node.js 18 o superiore
- File video su Google Drive condivisi con accesso tramite link

## Configurazione

Modifica `videos.json` aggiungendo i tuoi file:

```json
[
  {
    "title": "Titolo del video",
    "driveUrl": "https://drive.google.com/file/d/ID_DEL_FILE/view?usp=sharing",
    "filename": "video.mp4",
    "description": "Descrizione opzionale",
    "genre": "Personale"
  }
]
```

Puoi usare anche direttamente `driveId` al posto di `driveUrl`:

```json
{
  "title": "Titolo del video",
  "driveId": "ID_DEL_FILE",
  "filename": "video.mp4"
}
```

## Avvio locale

```bash
npm start
```

Poi apri in Stremio:

```text
http://127.0.0.1:7000/manifest.json
```

Su una TV o un dispositivo diverso dal Mac, `127.0.0.1` non funzionerà perché indica il dispositivo stesso. In quel caso avvia così, sostituendo l'IP con quello del Mac nella tua rete:

```bash
BASE_URL=http://192.168.1.50:7000 npm start
```

E installa in Stremio:

```text
http://192.168.1.50:7000/manifest.json
```

## Note importanti

- Google Drive deve permettere la lettura del file a chi ha il link.
- I file `.mp4`, `.m4v` e `.webm` sono i più compatibili con Stremio.
- Lo stream passa attraverso un piccolo proxy dell'add-on, cosi' Stremio riceve il file video invece delle pagine intermedie di Google Drive.
- Usa questo add-on solo per contenuti che hai il diritto di visualizzare e trasmettere sui tuoi dispositivi.

## Deploy su Render

1. Carica questi file su un repository GitHub privato o pubblico.
2. Su Render scegli **New +** > **Web Service**.
3. Collega il repository.
4. Usa queste impostazioni:
   - **Runtime**: Node
   - **Build Command**: lascia vuoto
   - **Start Command**: `npm start`
   - **Plan**: Free
5. Dopo il deploy, apri:

```text
https://NOME-SERVIZIO.onrender.com/manifest.json
```

Quello e' l'URL da installare in Stremio.

Render assegna automaticamente la porta tramite `PORT`, quindi non devi configurarla. L'add-on ricava anche automaticamente il dominio pubblico Render quando genera gli stream.
