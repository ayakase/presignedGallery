<script>
  import axios from 'axios';

  // State lưu danh sách file và phân trang
  let filesList = $state([]);
  let pagination = $state({ page: 1, limit: 5, total: 0, totalPages: 1 });
  let isUploading = $state(false);
  let uploadProgress = $state(0);
  let statusMessage = $state('');

  const API_URL = 'http://localhost:3000/api';

  // Lấy danh sách file có phân trang và đã BATCH SIGNING Pre-signed URLs
  async function loadFiles(page = pagination.page) {
    try {
      const res = await axios.get(`${API_URL}/files?page=${page}&limit=5`);
      filesList = res.data.data;
      pagination = res.data.pagination;
    } catch (err) {
      console.error('Lỗi tải danh sách file:', err);
    }
  }

  // Tự động load trang 1 khi mở web
  $effect(() => {
    loadFiles(1);
  });

  // Chuyển trang
  function goToPage(newPage) {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      loadFiles(newPage);
    }
  }

  // Upload file
  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      isUploading = true;
      uploadProgress = 0;
      statusMessage = `Đang tải lên: ${file.name}...`;

      const formData = new FormData();
      formData.append('file', file);

      await axios.post(`${API_URL}/files/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            uploadProgress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            statusMessage = `Đang tải lên: ${uploadProgress}%`;
          }
        },
      });

      statusMessage = '✓ Upload thành công!';
      setTimeout(() => {
        statusMessage = '';
        uploadProgress = 0;
      }, 3000);

      // Reload lại trang 1 để thấy file mới nhất vừa up
      await loadFiles(1);
    } catch (err) {
      statusMessage = `❌ Lỗi: ${err.response?.data?.error || err.message}`;
    } finally {
      isUploading = false;
      event.target.value = '';
    }
  }

  // Xóa file
  async function handleDelete(id, name) {
    if (!confirm(`Bạn có chắc muốn xóa file "${name}"?`)) return;

    try {
      await axios.delete(`${API_URL}/files/${id}`);
      await loadFiles(pagination.page);
    } catch (err) {
      alert(`Xóa thất bại: ${err.response?.data?.error || err.message}`);
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
</script>

<main class="gallery-app">
  <header class="app-header">
    <div class="header-badge">⚡ Batch Signing & Pagination</div>
    <h1>S3 Pre-signed Gallery (5 files/trang)</h1>
    <p class="subtitle">
      Ảnh được tải <strong>TRỰC TIẾP từ AWS S3</strong> qua <code>Pre-signed GET URL</code> (Server Node.js giải phóng 100% I/O!)
    </p>
  </header>

  <!-- Khu vực Upload -->
  <div class="upload-box">
    <div class="upload-controls">
      <label class="btn-upload" class:disabled={isUploading}>
        <input type="file" onchange={handleUpload} disabled={isUploading} style="display: none;" />
        {isUploading ? 'Đang Upload...' : '📁 Tải File Mới'}
      </label>
      {#if statusMessage}
        <span class="status">{statusMessage}</span>
      {/if}
    </div>

    {#if isUploading}
      <div class="progress-bar-container">
        <div class="progress-bar-fill" style="width: {uploadProgress}%;"></div>
      </div>
    {/if}
  </div>

  <!-- Danh sách file -->
  <div class="list-header">
    <h2>Kho Tàng File (Tổng {pagination.total} files - Trang {pagination.page}/{pagination.totalPages})</h2>
    <button class="btn-refresh" onclick={() => loadFiles(pagination.page)}>🔄 Làm Mới</button>
  </div>

  {#if filesList.length === 0}
    <div class="empty-card">
      <p>Trang này chưa có file nào.</p>
    </div>
  {:else}
    <div class="files-stack">
      {#each filesList as item}
        <div class="file-record-card">
          <!-- Cột trái: Preview tải TRỰC TIẾP TỪ S3 -->
          <div class="preview-column">
            {#if item.mimeType.startsWith('image/')}
              <!-- ẢNH ĐƯỢC TẢI THẲNG TỪ LINK AWS S3, BỎ QUA HOÀN TOÀN SERVER LOCALHOST! -->
              <img src={item.presignedUrl} alt={item.name} class="thumb-img" />
            {:else}
              <div class="non-img-placeholder">
                <span class="icon">📄</span>
                <span class="type-name">{item.mimeType}</span>
              </div>
            {/if}
            
            <a href={item.presignedUrl} target="_blank" class="btn-open-s3" rel="noreferrer">
              ☁ Mở Tab Mới (Trực Tiếp Từ S3)
            </a>
          </div>

          <!-- Cột giữa: Toàn bộ thông tin & Pre-signed URL -->
          <div class="data-column">
            <div class="card-title-row">
              <span class="badge-id">ID: #{item.id}</span>
              <strong class="file-name">{item.name}</strong>
              <button class="btn-delete" onclick={() => handleDelete(item.id, item.name)}>
                Xóa 🗑️
              </button>
            </div>

            <!-- Bảng key-value hiển thị mọi cột DB -->
            <table class="db-fields-table">
              <tbody>
                <tr>
                  <td class="col-key">s3_key</td>
                  <td class="col-val"><code class="s3-key-text">{item.s3Key}</code></td>
                </tr>
                <tr>
                  <td class="col-key">size / type</td>
                  <td class="col-val">
                    {formatBytes(item.size)} | <code>{item.mimeType}</code>
                  </td>
                </tr>
                <tr>
                  <td class="col-key">presigned_url</td>
                  <td class="col-val">
                    <div class="presigned-url-box">
                      <span class="presigned-tag">Hạn 5 phút</span>
                      <input 
                        type="text" 
                        readonly 
                        value={item.presignedUrl} 
                        onclick={(e) => e.target.select()} 
                        class="presigned-input" 
                        title="Click để bôi đen toàn bộ link S3 có chữ ký"
                      />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      {/each}
    </div>

    <!-- THANH PHÂN TRANG (PAGINATION CONTROLS) -->
    <div class="pagination-bar">
      <button 
        class="page-btn" 
        disabled={pagination.page <= 1} 
        onclick={() => goToPage(pagination.page - 1)}
      >
        ◀ Trang Trước
      </button>

      <div class="page-indicators">
        {#each Array(pagination.totalPages) as _, idx}
          <button 
            class="page-num-btn" 
            class:active={pagination.page === idx + 1}
            onclick={() => goToPage(idx + 1)}
          >
            {idx + 1}
          </button>
        {/each}
      </div>

      <button 
        class="page-btn" 
        disabled={pagination.page >= pagination.totalPages} 
        onclick={() => goToPage(pagination.page + 1)}
      >
        Trang Sau ▶
      </button>
    </div>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, -apple-system, sans-serif;
    background: #0b0f19;
    color: #e2e8f0;
  }

  .gallery-app {
    max-width: 1000px;
    margin: 0 auto;
    padding: 30px 20px;
  }

  .header-badge {
    background: #6366f1;
    color: white;
    font-size: 11px;
    font-weight: bold;
    display: inline-block;
    padding: 3px 8px;
    border-radius: 4px;
    margin-bottom: 8px;
    text-transform: uppercase;
  }

  .app-header h1 {
    margin: 0 0 6px 0;
    font-size: 24px;
    color: #f8fafc;
  }

  .subtitle {
    color: #94a3b8;
    margin: 0 0 24px 0;
    font-size: 14px;
  }

  .subtitle code {
    background: #1e293b;
    padding: 2px 6px;
    border-radius: 4px;
    color: #38bdf8;
  }

  .upload-box {
    background: #151c2e;
    border: 1px solid #222d45;
    padding: 16px 20px;
    border-radius: 10px;
    margin-bottom: 30px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .upload-controls {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .btn-upload {
    background: #3b82f6;
    color: white;
    padding: 10px 18px;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    font-size: 14px;
    transition: 0.2s;
  }
  .btn-upload:hover { background: #2563eb; }
  .btn-upload.disabled { opacity: 0.5; cursor: not-allowed; }

  .status { font-size: 14px; color: #38bdf8; }

  .progress-bar-container {
    width: 100%;
    height: 8px;
    background: #252f48;
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background: #10b981;
    transition: width 0.15s ease-in-out;
  }

  .list-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .list-header h2 {
    font-size: 18px;
    margin: 0;
    color: #f1f5f9;
  }

  .btn-refresh {
    background: #1e293b;
    border: 1px solid #334155;
    color: #cbd5e1;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
  }
  .btn-refresh:hover { background: #334155; }

  .empty-card {
    background: #151c2e;
    border: 1px dashed #2d3748;
    padding: 40px;
    text-align: center;
    border-radius: 10px;
    color: #64748b;
  }

  .files-stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 24px;
  }

  .file-record-card {
    background: #151c2e;
    border: 1px solid #222d45;
    border-radius: 10px;
    padding: 16px;
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 20px;
    align-items: start;
  }

  @media (max-width: 768px) {
    .file-record-card {
      grid-template-columns: 1fr;
    }
  }

  .preview-column {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .thumb-img {
    width: 100%;
    height: 150px;
    object-fit: cover;
    border-radius: 6px;
    background: #090d16;
    border: 1px solid #28354f;
  }

  .non-img-placeholder {
    width: 100%;
    height: 150px;
    background: #090d16;
    border: 1px solid #28354f;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .non-img-placeholder .icon { font-size: 36px; }
  .non-img-placeholder .type-name { font-size: 11px; color: #94a3b8; padding: 0 8px; text-align: center; }

  .btn-open-s3 {
    font-size: 11px;
    color: #38bdf8;
    text-decoration: none;
    text-align: center;
    padding: 6px 8px;
    border-radius: 4px;
    background: #1e293b;
    border: 1px solid #334155;
    font-weight: 500;
  }
  .btn-open-s3:hover {
    background: #27354d;
    border-color: #38bdf8;
  }

  .data-column {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .card-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .badge-id {
    background: #4f46e5;
    color: white;
    font-size: 11px;
    font-weight: bold;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .file-name {
    font-size: 15px;
    color: #f8fafc;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btn-delete {
    background: #ef4444;
    color: white;
    border: none;
    padding: 5px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .btn-delete:hover { background: #dc2626; }

  .db-fields-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .db-fields-table tr {
    border-bottom: 1px solid #1f283d;
  }

  .db-fields-table tr:last-child {
    border-bottom: none;
  }

  .col-key {
    padding: 6px 8px;
    color: #94a3b8;
    font-family: monospace;
    width: 120px;
    font-weight: 600;
    vertical-align: top;
  }

  .col-val {
    padding: 6px 8px;
    color: #e2e8f0;
    word-break: break-all;
  }

  .col-val code {
    background: #090d16;
    padding: 2px 6px;
    border-radius: 4px;
    color: #38bdf8;
    font-size: 12px;
  }

  .s3-key-text {
    color: #a7f3d0 !important;
  }

  .presigned-url-box {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .presigned-tag {
    font-size: 10px;
    background: #065f46;
    color: #6ee7b7;
    width: fit-content;
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: bold;
  }

  .presigned-input {
    width: 100%;
    background: #090d16;
    border: 1px solid #28354f;
    color: #93c5fd;
    font-family: monospace;
    font-size: 11px;
    padding: 5px 8px;
    border-radius: 4px;
    box-sizing: border-box;
    cursor: pointer;
  }
  .presigned-input:focus {
    outline: 1px solid #60a5fa;
    border-color: #60a5fa;
  }

  /* PHÂN TRANG */
  .pagination-bar {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 12px;
    padding: 16px;
    background: #151c2e;
    border: 1px solid #222d45;
    border-radius: 8px;
  }

  .page-btn {
    background: #1e293b;
    border: 1px solid #334155;
    color: #f1f5f9;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    transition: 0.15s;
  }
  .page-btn:hover:not(:disabled) {
    background: #334155;
    border-color: #60a5fa;
  }
  .page-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .page-indicators {
    display: flex;
    gap: 6px;
  }

  .page-num-btn {
    background: #1e293b;
    border: 1px solid #334155;
    color: #cbd5e1;
    min-width: 32px;
    height: 32px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }
  .page-num-btn.active {
    background: #4f46e5;
    color: white;
    border-color: #6366f1;
  }
</style>