# Ichthus+ voor iPhone

De iPhone-versie van Ichthus+. Net als op Android is het een venster op het leerlingenportaal waar `app.js`
(precies dezelfde als in de Android-app) zijn eigen scherm overheen zet.

## Hoe het werkt

- `IchthusPlus/` – de Swift-code:
  - `WebViewController` laadt het portaal, `Bridge` is `window.CijferApp` voor app.js.
  - `ZermeloLogin` koppelt Zermelo met je schoolaccount, `Agenda` haalt de jaaragenda op.
  - `Checker` + `Portal` + `Background`: af en toe op de achtergrond kijken naar nieuwe cijfers, huiswerk en
    roosterwijzigingen (iOS bepaalt zelf hoe vaak), met meldingen.
  - `Reminders` en `HomeworkReminders`: eigen reminders en huiswerkherinneringen, alvast ingepland zodat ze ook
    afgaan als de app dicht is.
  - `Updates`: het update-vakje; "Nu bijwerken" opent SideStore met de nieuwe versie.
- `IchthusWidget/` – de widget "volgende les" (klein, middel en op het toegangsscherm).
- `web/` – app.js, lettertypes en plaatjes, gekopieerd uit de Android-app met `sync.ps1`.
- `project.yml` – het Xcode-project; GitHub Actions maakt er zelf een `.xcodeproj` van (geen Mac nodig).
- `.github/workflows/build.yml` – bouwt een niet-ondertekende `IchthusPlus.ipa`. SideStore ondertekent hem met je eigen Apple ID.

## Bijwerken

```
.\iphone\sync.ps1
.\iphone\push.ps1 -Message "Wat er veranderd is"
```

Met `-Tag v0.2.0` erbij komt er ook een release met de `.ipa` en een `source.json` voor SideStore.

## Installeren

SideStore → My Apps → **+** → kies `IchthusPlus.ipa`.
Als de repo openbaar is: SideStore → Sources → **+** →
`https://github.com/wesssaa/Ichthus-Plus-iPhone/releases/latest/download/source.json` (dan zie je updates in SideStore).
