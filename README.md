# Pecutan

Extension Chrome iseng: sebuah cambuk menempel di kursor dan ikut berayun saat mouse digerakkan.
Klik kiri untuk mencambuk, lengkap dengan bunyi **"CTAR!"**, supaya AI-mu kerjanya lebih ngebut.

Terinspirasi dari [whip-ur-ai-agents](https://github.com/ArtinTopojani/whip-ur-ai-agents) (aplikasi tray Windows),
tapi ditulis ulang dari nol sebagai extension browser. Animasi digambar dengan canvas, suaranya disintesis
dengan Web Audio API, jadi tidak ada aset yang disalin.

## Cara pasang

1. Buka `chrome://extensions`.
2. Aktifkan **Developer mode** (pojok kanan atas).
3. Klik **Load unpacked**, lalu pilih folder ini (`pecutan`).
4. Buka [chatgpt.com](https://chatgpt.com) atau [claude.ai](https://claude.ai). Tab yang sudah terbuka perlu di-refresh dulu.

## Cara pakai

| Aksi | Hasil |
|---|---|
| Gerakkan mouse | Cambuk mengikuti kursor dan talinya berayun |
| Klik kiri | Tangan mundur, mengayun, dan ujung cambuk menghantam **tepat di titik yang diklik**, lalu muncul bunyi "ctar!" |
| `Alt+Shift+W` | Aktifkan / matikan cambuk |
| `Alt+Shift+M` | Nyalakan / matikan suara |
| Ikon extension | Popup berisi tombol aktif/suara dan total cambukan |

Klik tetap tembus ke halaman, jadi tombol "Send" dan lainnya tetap berfungsi seperti biasa.
Shortcut bisa diganti di `chrome://extensions/shortcuts`.

## Batasan

- Hanya aktif di `chatgpt.com`, `chat.openai.com`, dan `claude.ai`.
- Di dalam iframe (misalnya pratinjau artifact di Claude), cambuk berhenti mengikuti kursor
  karena event mouse tidak sampai ke halaman utama.

## Struktur

```
manifest.json   konfigurasi extension (Manifest V3)
content.js      fisika tali cambuk, animasi, dan suara
background.js   shortcut keyboard dan badge OFF
popup.html/js   panel kontrol
icons/          ikon extension
dev/test.html   halaman uji tanpa memasang extension
```

## Mengatur rasa cambuk

Konstanta di bagian atas `content.js`:

- `SEGMENTS`, `SEG_LEN` untuk panjang tali
- `GRIP_OFFSET` untuk posisi gagang relatif terhadap kursor
- `STRIKE_REACH`, `STRIKE_DIRS` untuk jarak dan arah tangan dari titik klik saat menghantam
- `T_WINDUP`, `T_STRIKE`, `T_HOLD`, `T_RETURN` untuk durasi tiap fase ayunan
- `GRAVITY`, `DAMPING` untuk seberapa berat dan lentur talinya

Untuk mencoba perubahan tanpa reload extension, jalankan server lokal di folder ini
(misalnya `python -m http.server 8765`), lalu buka `http://localhost:8765/dev/test.html`.
