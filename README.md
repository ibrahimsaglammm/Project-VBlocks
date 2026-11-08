# Prizma Tetris — Renkli Patlamalı Modern Tetris (Mobil & Masaüstü)

Saf **HTML5 + CSS3 + ES Modülleri (Vanilla JavaScript)** ile geliştirilmiş, hiçbir harici kütüphane veya derleme adımı gerektirmeyen, **Modern Tetris Guideline (SRS, 7-Bag, T-Spin, B2B, Kombo, Perfect Clear)** kurallarına tam uyumlu, hem telefonlarda (portre/yatay) hem de masaüstünde (klavye ve gamepad ile) kusursuz çalışan **PWA (Progressive Web App)** Tetris oyunu.

---

## Öne Çıkan Özellikler

1. **Her Blok Karakterine Özel Renk ve Her Yeni Seviyede Rastgele Değişim**:
   - 7 tetromino karakterinin (`I, O, T, S, Z, J, L`) her biri kendine ait ayırt edici bir renge sahiptir (örneğin 1. seviyede **T Kırmızı**, **L Mavi**).
   - Her 10 satırda bir yeni bölüme/seviyeye geçildiğinde, 7 blok karakterinin renk dağılımı rastgele yeniden karıştırılır. Üst bilgi çubuğundaki (HUD) **Seviye Renkleri** göstergesinden mevcut seviyenin blok renkleri anlık olarak takip edilebilir.
2. **Renkli Blok Patlamaları**:
   - Bir satır tamamlanıp yıkıldığında, o satırdaki her bir hücre kendi renginde çok katmanlı parçacık patlamaları, şok halkaları ve kıvılcımlar saçarak yok olur.
3. **Canlı Hız ve Seviye Telemetrisi**:
   - Oyun ekranında anlık **Seviye (Level)**, **Hız Çarpanı ve Satır/Saniye Değeri (`1.00x`, `satır/sn`)**, **Skor**, **Satır** ve **Süre** bilgileri yer alır.
4. **7 Haneli İsim Yazdırmalı Rekorlar Bölümü**:
   - Oyun sonunda ulaşılan skor ve istatistiklerle birlikte **7 haneli oyuncu ismi** (`maxlength="7"`, örn. `USTA001`, `OYUNCU1`) kaydedilebilir.
   - Her oyun modu (**Maraton**, **Sprint 40 Satır**, **Ultra 2 Dakika**, **Zen**) için ayrı **Rekorlar (High Scores)** tablosu `localStorage` üzerinde saklanır.
5. **Modern Tetris Guideline Mekanikleri**:
   - **7-Bag Randomizer** (Deterministik / tohumlanabilir PRNG)
   - **Super Rotation System (SRS)**: `JLSTZ` ve `I` parçaları için tam duvar tekmesi (wall-kick) tabloları (meşhur **T-Spin Triple / TST** 5. tekmesi dahil) ve 180° döndürme desteği
   - **3 Köşe Kuralı ile T-Spin Algılama** (Full ve Mini T-Spin, Back-to-Back `x1.5`, Kombo ve Perfect Clear bonusları)
   - **500 ms Kilit Gecikmesi (Lock Delay)**: Hareket/döndürme başına en fazla 15 sıfırlama (veya ayarlarda Sonsuz Kilit modu)
   - **5 Parçalık Sonraki Kuyruğu (Next 5)**, **Parça Tutma (Hold)** ve **Hayalet Parça (Ghost Piece)**
6. **Web Audio API Sentezleyici**:
   - Hiçbir ses dosyası kullanmadan kodla üretilen ses efektleri ve seviyeyle hızlanan prosedürel arka plan müziği.

---

## Nasıl Çalıştırılır?

**En kolay yol:** `index.html` dosyasına çift tıklayın — oyun doğrudan tarayıcıda (`file://`) açılır ve tüm modlar çalışır.

> `index.html`, `/src` altındaki ES modüllerinden üretilmiş tek bir klasik script olan `dist/tetris.bundle.js` dosyasını yükler. Tarayıcılar `file://` üzerinden açılan sayfalarda ES modül (`type="module"`) yüklemesini CORS nedeniyle engellediği için bu paket kullanılır.
> `/src` altında bir değişiklik yaptıktan sonra paketi yeniden üretin: `node scripts/build.mjs` (veya `npm run build`).

PWA kurulumu ve çevrimdışı mod (Service Worker) yalnızca `http/https` üzerinden çalışır. Bunun için basit bir statik sunucu kullanın:

```bash
# Seçenek 1: Node.js npx serve ile
npx serve .

# Seçenek 2: Python 3 ile
python -m http.server 8080
```

Ardından tarayıcınızda `http://localhost:8080` (veya `npx serve` tarafından verilen adresi) açın.

### Birim Testlerini Çalıştırma

Oyun çekirdeği DOM ve Canvas'tan tamamen bağımsızdır. Node.js yerleşik test çalıştırıcısı ile testleri çalıştırmak için:

```bash
node --test tests/tetris.test.js tests/bundle.test.js
```

`tests/bundle.test.js`, `dist/tetris.bundle.js` dosyasının `/src` ile güncel olup olmadığını da kontrol eder.

---

## Kontroller Tablosu

| Eylem | Dokunmatik (Hareket Şeması) | Dokunmatik (Ekran Tuşları) | Klavye (Masaüstü) | Gamepad (Oyun Kolu) |
| :--- | :--- | :--- | :--- | :--- |
| **Sola / Sağa Hareket** | Parmağı yatay sürükle | `◀` / `▶` tuşları | `Sol` / `Sağ Ok` (veya `J` / `L`) | D-Pad Sol/Sağ veya Sol Analog |
| **Saat Yönü Döndür (CW)** | Oyun alanına tek dokunuş | `↻` tuşu | `Yukarı Ok` veya `X` | `A` (Xbox) / `✕` (PS) |
| **Ters Yön Döndür (CCW)** | İki parmakla dokunuş | `↺` tuşu | `Z` veya `Ctrl` | `B` (Xbox) / `○` (PS) |
| **180° Döndür** | — | — | `A` (Ayarlardan değiştirilebilir) | `X` (Xbox) / `□` (PS) |
| **Yumuşak İndir (Soft Drop)** | Yavaşça aşağı sürükle | `▼` tuşu | `Aşağı Ok` (veya `K`) | D-Pad Aşağı |
| **Anında İndir (Hard Drop)** | Hızlıca aşağı kaydır (Flick) | `⤓` tuşu | `Boşluk (Space)` | D-Pad Yukarı |
| **Parça Tut (Hold)** | Yukarı kaydır / `TUT` kutusuna dokun | `⇄` tuşu | `C` veya `Shift` | `Y` / `LB` / `RB` |
| **Duraklat (Pause)** | Üst çubuktaki `⏸` tuşu | `⏸` tuşu | `Escape` veya `P` | `Start` |
| **Hızlı Yeniden Başlat** | Duraklat menüsünden | Duraklat menüsünden | `R` | `Select / Back` |

---

## Proje Yapısı

```text
/
├── index.html             # Mobil-öncelikli ana uygulama ve modal arayüzleri
├── styles.css             # Duyarlı (Responsive) düzen, Neon/Klasik/Minimal temalar
├── manifest.json          # Kurulabilir PWA bildirimi
├── sw.js                  # Çevrimdışı (Offline) çalışma için Service Worker
├── icon.svg               # Vektörel uygulama ikonu
├── package.json           # ES Modül tanımı ve birim testi betiği
├── src/
│   ├── main.js            # Sabit zaman adımlı (60 FPS) oyun döngüsü ve başlatıcı
│   ├── game.js            # Saf (Pure) Tetris durum makinesi ve oyun modları
│   ├── board.js           # 10x22 ızgara, çarpışma, SRS döndürme, T-Spin ve satır silme
│   ├── pieces.js          # Tetromino matrisleri, SRS duvar tekmeleri ve seviye renk üretici
│   ├── randomizer.js      # Tohumlanabilir (Seeded) 7-Bag rastgele parça üretici
│   ├── scoring.js         # Guideline yerçekimi formülü, hız telemetrisi ve puanlama motoru
│   ├── effects.js         # Nesne havuzlu (Object-Pooled) renkli patlama parçacıkları ve sarsıntı
│   ├── renderer.js        # HiDPI 2D Canvas çizici ve önbellekli (Cached) blok spriteları
│   ├── audio.js           # Web Audio API ses efektleri ve prosedürel müzik sentezleyici
│   ├── storage.js         # 7 haneli rekor tablosu, ayarlar ve oyun durumu kaydı (localStorage)
│   ├── settings.js        # Varsayılan ayarlar ve Türkçe/İngilizce dil sözlüğü (i18n)
│   ├── ui.js              # Menü, HUD, 7 haneli rekor girişi ve ayarlar kontrolcüsü
│   └── input/
│       ├── keyboard.js    # DAS/ARR destekli ve yeniden atanabilir klavye kontrolcüsü
│       ├── touch.js       # Çoklu dokunuş hareketleri, ekran tuşları ve titreşim (Haptics)
│       └── gamepad.js     # Standart Gamepad API kontrolcüsü
└── tests/
    └── tetris.test.js     # Node.js birim testleri (7-bag, SRS/TST, T-Spin, puanlama, renkler)
```

---

## Statik Site Olarak Yayınlama (GitHub Pages / Netlify)

Proje hiçbir derleme (build) adımı gerektirmediğinden doğrudan statik olarak yayınlanabilir:

- **GitHub Pages**:
  1. Depoyu GitHub'a yükleyin.
  2. **Settings → Pages** bölümüne gidin.
  3. **Branch** olarak `main` (veya `master`) ve klasör olarak `/ (root)` seçip **Save** butonuna tıklayın.
- **Netlify / Vercel**:
  1. Proje klasörünü doğrudan [Netlify Drop](https://app.netlify.com/drop) ekranına sürükleyip bırakın veya Git deponuzu bağlayın.
  2. **Build Command** alanını boş bırakın, **Publish Directory** alanını `.` olarak ayarlayın.
