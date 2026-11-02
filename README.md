# Ichthus+ voor iPhone (privé)

De iPhone-versie van Ichthus+. Net als op Android is het een venster op het leerlingenportaal waar `app.js`
(precies dezelfde als in de Android-app) zijn eigen scherm overheen zet.

## Hoe het werkt

- `IchthusPlus/` – de Swift-code: het portaal laden (`WebViewController`), `window.CijferApp` voor app.js (`Bridge`),
  Zermelo koppelen met je schoolaccount (`ZermeloLogin`), de jaaragenda (`Agenda`) en eigen reminders als
  melding (`Reminders`: de komende keren staan alvast ingepland, zodat ze ook afgaan als de app dicht is).
- `web/` – app.js, lettertypes en plaatjes, gekopieerd uit de Android-app met `sync.ps1`.
- `project.yml` – het Xcode-project; GitHub Actions maakt er zelf een `.xcodeproj` van (geen Mac nodig).
- `.github/workflows/build.yml` – bouwt een niet-ondertekende `IchthusPlus.ipa`. SideStore ondertekent hem met je eigen Apple ID.

## Bijwerken

```
.\iphone\sync.ps1
.\iphone\push.ps1 -Message "Wat er veranderd is"
```

Met `-Tag v0.1.0` erbij komt er ook een release met de `.ipa`.

## Installeren

SideStore → My Apps → **+** → kies `IchthusPlus.ipa`.

## Wat er (nog) niet in zit

- Meldingen over nieuwe cijfers, huiswerk en roosterwijzigingen (iOS laat apps maar af en toe op de achtergrond kijken)
- Widget
- Updates vanuit de app (gaat via SideStore)
