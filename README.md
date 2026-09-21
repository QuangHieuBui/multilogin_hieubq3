# Multi-Profile Login (MV3)

Extension Chrome (Manifest V3) cho phép mở **nhiều tài khoản của cùng một website** trong
các tab riêng biệt, không cần đăng xuất, không cần đổi profile Chrome — kiểu MultiLogin/SessionBox
đời cũ, nhưng viết lại theo cơ chế mà MV3 còn cho phép.

## Cơ chế hoạt động

MV3 đã bỏ `webRequest` blocking cho extension thường, nên không thể tráo header `Cookie` đồng bộ
theo từng request như trước. Thay vào đó extension này dùng:

1. **`declarativeNetRequest` session rule** xoá mọi header `Set-Cookie` trả về cho domain đã
   thêm — vì vậy cookie jar thật của Chrome không bao giờ bị ghi cho domain đó nữa. Từ lúc này
   extension là nơi duy nhất giữ session.
2. **`chrome.webRequest.onHeadersReceived`** (non-blocking, chỉ đọc) để bắt các `Set-Cookie` đó
   trước khi bị xoá, gộp vào một "cookie jar" riêng theo từng **profile** (do bạn đặt tên) lưu
   trong `chrome.storage.local`.
3. Một **session rule khác, có điều kiện `tabIds`** (chỉ dùng được cho session rule, từ Chrome 92)
   để gán header `Cookie` = jar của profile đang active cho đúng tab đó khi gửi request đi.

Kết quả: mỗi tab có thể "nhìn thấy" một cookie session khác nhau cho cùng một domain, dù tất cả
đều chạy trong cùng một cửa sổ, cùng một profile Chrome.

## Giới hạn quan trọng — đọc trước khi dùng

- **Chỉ xử lý cookie.** `localStorage`, `sessionStorage`, `IndexedDB`, Cache API, Service Worker
  đều lưu theo origin ở cấp trình duyệt, không theo tab. Nếu site lưu token đăng nhập (JWT,
  refresh token...) ở những chỗ này thay vì cookie, các tab trong cùng profile Chrome **vẫn sẽ tự
  động dùng chung một tài khoản** — extension không có cách nào cô lập được. Trước khi tin tưởng
  vào một site, mở DevTools → tab **Application** → xem mục Local Storage / IndexedDB sau khi
  đăng nhập, nếu thấy token ở đó thì kỹ thuật này không đủ; cần dùng nhiều Chrome Profile thật
  hoặc Puppeteer/Playwright với `userDataDir` riêng cho từng tài khoản.
- Đóng tab thì profile đang gán cho tab đó bị gỡ (tab id sẽ bị Chrome tái sử dụng). Mở tab mới
  và chọn lại profile trong popup bình thường.
- Session rule không tồn tại qua việc khởi động lại trình duyệt; extension tự tạo lại rule "xoá
  Set-Cookie" mỗi khi Chrome khởi động (`chrome.runtime.onStartup`), nhưng bạn cần mở lại popup
  và chọn profile cho từng tab sau khi khởi động lại.
- Giới hạn 5000 session rule (Chrome 120+) — dư sức cho vài chục tab dùng cá nhân.

Extension khai báo quyền host cho **mọi trang web** (`<all_urls>`) ngay từ lúc cài — đây là đánh
đổi có chủ đích để không phải xin quyền từng domain giữa chừng (xem mục "Mở phiên mới" bên dưới).
Nhưng thực tế extension chỉ **đọc/ghi cookie** trên những domain bạn đã thêm (thủ công hoặc qua
nút "Mở phiên mới") — domain nào chưa thêm thì extension hoàn toàn không đụng tới, dù kỹ thuật có
quyền truy cập.

## Cài đặt (load unpacked)

1. Mở `chrome://extensions`.
2. Bật **Developer mode** (góc trên phải).
3. Bấm **Load unpacked**, chọn thư mục `multilogin-extension` này. Chrome sẽ hiện cảnh báo quyền
   "Đọc và thay đổi dữ liệu trên tất cả trang web" — đồng ý (đây là quyền `<all_urls>` nói trên).
4. Ghim icon extension lên thanh công cụ cho dễ dùng.

## Cách dùng — nhanh nhất: nút "Mở phiên mới"

1. Bấm icon extension → bấm **"➕ Mở phiên mới"**. Một tab trắng mới mở ra.
2. Gõ hoặc dán URL trang web bạn muốn vào tab đó (hoặc bấm 1 bookmark, tìm kiếm...). Ngay khi
   trang bắt đầu tải, extension **tự động**: thêm domain đó vào danh sách quản lý (nếu chưa có),
   tạo một profile mới trống, gán cho tab này, rồi tự reload tab — không cần bấm "Thêm domain"
   hay đặt tên profile thủ công. Bạn đăng nhập tài khoản đầu tiên bình thường.
3. Muốn thêm tài khoản thứ 2 cho cùng site: lại bấm icon → **"➕ Mở phiên mới"** → dán cùng URL đó
   vào tab mới → đăng nhập tài khoản khác. Cứ lặp lại cho mỗi tài khoản.
4. Đang mở nhiều phiên cùng lúc, muốn chuyển tab hiện tại sang một phiên khác đã tạo: bấm icon,
   sẽ thấy danh sách các phiên đang mở của domain đó, bấm **Dùng** trên phiên muốn chuyển sang.

Lưu ý: nút "Mở phiên mới" chỉ tự động hoá cho **trang đầu tiên** bạn vào trong tab mới đó — nếu
sau đó bạn điều hướng tab này sang domain khác, domain thứ hai sẽ không được tự thêm (tránh mỗi
cú click link lại vô tình tạo domain quản lý mới ngoài ý muốn).

**Phiên gắn liền vòng đời của tab, không phải tài khoản lưu vĩnh viễn:** đóng tab đang giữ một
phiên thì phiên đó (cookie, tên, mọi thứ) bị **xoá luôn** khỏi danh sách — trừ khi đúng lúc đó vẫn
còn tab khác cũng đang dùng chính phiên đó thì mới giữ lại. Vì vậy danh sách trong popup chỉ hiện
những phiên tương ứng với tab đang mở, không tích tụ phiên cũ theo thời gian. Nếu bạn cần một tài
khoản dùng đi dùng lại lâu dài, đừng đóng tab đó (hoặc dùng "Thêm domain này" + **Tạo** thủ công và
luôn giữ ít nhất 1 tab đang mở phiên đó).

Có 2 kiểu "đóng" xoá phiên khác nhau:

- **Đóng từng tab** (bấm x trên tab, hoặc Ctrl+W): phiên của đúng tab đó bị xoá ngay lập tức,
  các phiên khác (đang mở ở tab khác) không bị ảnh hưởng.
- **Đóng/tắt hẳn trình duyệt rồi mở lại**: Chrome tự xoá sạch bộ nhớ tạm mà extension dùng để nhớ
  "tab nào đang giữ phiên nào" (đây là hành vi mặc định của `chrome.storage.session`, không phải
  extension tự ý), nên **toàn bộ danh sách phiên còn lại sẽ bị xoá sạch một lượt** ngay khi Chrome
  khởi động lại — kể cả domain đã quản lý vẫn được giữ, chỉ các phiên/cookie bên trong bị dọn.
  Nếu sau khi mở lại Chrome vẫn còn thấy phiên cũ trong popup, đó là bản extension **chưa được
  reload lần cuối cùng** (vào `chrome://extensions` reload lại là hết).

## Cách dùng — thủ công (không qua nút "Mở phiên mới")

Nếu bạn đã mở sẵn 1 tab tới site muốn dùng (không qua nút trên), popup vẫn có nút **"Thêm domain
này"** để đăng ký thủ công, rồi bấm **Tạo** để đặt tên và tạo profile như trước.

## Phân biệt tab (giống badge profile của Multilogin)

Vì cùng 1 site nên các tab trông giống hệt nhau trên tab strip (cùng icon, cùng title), dễ bấm
nhầm tài khoản. Mỗi khi một tab được gán/đổi profile (bấm Tạo hoặc Dùng), extension gắn thêm một
mã 6 số vào **đầu tiêu đề trang** của tab đó, dạng `[482913:acc1] <tiêu đề gốc>` — mã lấy từ 6 số
cuối của mili-giây tại thời điểm gán, nên mỗi lần gán là một mã khác nhau. Mã này hiện ngay trên
tab strip (không cần hover) và popup cũng hiển thị lại mã đó cạnh tên profile đang dùng trong tab
hiện tại. Cơ chế: một content script nhỏ (`content/tagTitle.js`) được tự động đăng ký cho từng
domain đã quản lý, hỏi background "tab này đang gắn tag gì" và ghi đè `document.title` — kể cả khi
site tự đổi title (SPA chuyển route) thì mã vẫn được giữ nguyên ở đầu.

## Cấu trúc mã nguồn

```
manifest.json         Khai báo permission, service worker, popup, options page
background.js         Service worker: bắt Set-Cookie, quản lý message từ popup/options/content script
lib/cookieJar.js       Parse / gộp / serialize Set-Cookie ↔ Cookie header
lib/storage.js          Đọc/ghi domain quản lý, profile, và tab-đang-dùng-profile-nào (kèm tag)
lib/rules.js            Tạo/xoá declarativeNetRequest session rule (strip Set-Cookie, inject Cookie)
lib/tagging.js          Đăng ký/gỡ content script gắn tag tiêu đề theo domain; sinh mã 6 số
content/tagTitle.js     Content script: ghi đè document.title với tag của tab, giữ nguyên khi site đổi title
popup.html/js           UI chọn/tạo/xoá profile cho tab hiện tại, hiện tag đang dùng
options.html/js         UI quản lý danh sách domain (thêm/xoá domain, báo trạng thái)
```
