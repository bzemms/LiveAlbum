# LiveAlbum

אלבום תמונות משפחתי על גלובוס תלת-ממדי: כל תמונה מופיעה במקום שבו צולמה, ו"מסע" מונפש עובר ביניהן לפי סדר הזמן.

## מה יש בגרסה הזו (שלב 1: אב-טיפוס)
- גלובוס תלת-ממדי ([globe.gl](https://github.com/vasturiano/globe.gl)) עם צילומי לוויין שמתחדדים בזום
- גרירה או בחירה של תמונות. מיקום ותאריך נקראים מנתוני ה-EXIF ישירות בדפדפן ([exifr](https://github.com/MikeKovarik/exifr))
- שמות מקומות אוטומטיים (OpenStreetMap Nominatim; נשלחות רק הקואורדינטות)
- ציר זמן לפי שנים, תצוגת תמונה, ומסע מונפש בין המקומות
- אלבום דוגמה (גלויות מצוירות, לא תמונות אמיתיות)
- התמונות לא עולות לשום שרת

## הרצה מקומית
```bash
npm install
npm run dev
```

## פריסה
אתר סטטי: פקודת build היא `npm run build`, ותיקיית הפלט היא `dist`.

- **Vercel:** Add New → Project → לייבא את הריפו `LiveAlbum`. Vercel מזהה Vite לבד.
- **Cloudflare Pages:** Workers & Pages → Create → Pages → Connect to Git → Build command `npm run build`, Output `dist`.

כל push לריפו יוצר פריסה חדשה אוטומטית.
