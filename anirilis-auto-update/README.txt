ANIRILIS — NETLIFY + AUTO UPDATE
=================================

FUNGSI
- Frontend statis untuk Netlify.
- GitHub Actions mengecek rilisan baru setiap 6 jam.
- Script memperbarui assets/js/data.js dan assets/data/anime.json.
- Netlify otomatis deploy lagi setelah GitHub melakukan push.
- Hanya metadata, poster, nomor episode, dan tautan halaman sumber.
- Tidak mengunduh, menyimpan, menyalin, atau meng-embed file video.

SETUP RINGKAS
1. Buat repository GitHub baru.
2. Upload SEMUA isi folder ini ke repository (termasuk folder .github).
3. Di Netlify: Add new project > Import an existing project > GitHub.
4. Pilih repository tadi. Publish directory: .
5. Deploy.
6. Di GitHub buka Actions > Update anime metadata > Run workflow untuk tes pertama.
7. Jika berhasil, file data diperbarui dan Netlify deploy otomatis.

CATATAN
- Workflow berjalan 4 kali sehari (setiap 6 jam).
- Jika struktur situs sumber berubah, scraper mungkin perlu diperbarui.
- Hormati robots.txt, ketentuan situs sumber, dan hak cipta.
