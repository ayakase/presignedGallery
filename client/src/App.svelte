<script>
  import axios from 'axios';

  // State thư mục & Breadcrumbs
  let currentFolderId = $state(null);
  let foldersList = $state([]);
  let breadcrumbs = $state([{ id: null, name: 'Bộ nhớ của tôi' }]);
  let newFolderName = $state('');
  let showCreateFolderInput = $state(false);

  // View mode: 'grid' hoặc 'list' (chuẩn phong cách Google Drive)
  let viewMode = $state('grid');

  // State tìm kiếm toàn hệ thống
  let searchQuery = $state('');

  // State danh sách file và phân trang
  let filesList = $state([]);
  let pagination = $state({ page: 1, limit: 50, total: 0, totalPages: 1 });
  let isUploading = $state(false);
  let uploadTasks = $state([]);
  let statusMessage = $state('');

  // State kết quả Duyệt đệ quy (Recursive Traversal)
  let recursiveData = $state(null);
  let isTraversing = $state(false);

  const API_URL = 'http://localhost:3000/api';

  // 1. Tải danh sách thư mục con của folder hiện tại
  async function loadFolders() {
    if (searchQuery.trim()) return;
    try {
      const query = currentFolderId ? `?parentId=${currentFolderId}` : '';
      const res = await axios.get(`${API_URL}/folders${query}`);
      foldersList = res.data;
    } catch (err) {
      console.error('Lỗi tải folders:', err);
    }
  }

  // 2. Tải danh sách file
  async function loadFiles(page = pagination.page) {
    try {
      let queryParams = `page=${page}&limit=50`;
      
      if (searchQuery.trim()) {
        queryParams += `&q=${encodeURIComponent(searchQuery.trim())}`;
      } else if (currentFolderId) {
        queryParams += `&folderId=${currentFolderId}`;
      }

      const res = await axios.get(`${API_URL}/files?${queryParams}`);
      filesList = res.data.data;
      pagination = res.data.pagination;
    } catch (err) {
      console.error('Lỗi tải file:', err);
    }
  }

  // Tự động tải lại khi đổi folder hoặc search query
  $effect(() => {
    currentFolderId;
    searchQuery;
    loadFolders();
    loadFiles(1);
  });

  function goToPage(newPage) {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      loadFiles(newPage);
    }
  }

  function enterFolder(folder) {
    searchQuery = '';
    currentFolderId = folder.id;
    breadcrumbs = [...breadcrumbs, { id: folder.id, name: folder.name }];
  }

  function goToBreadcrumb(index) {
    searchQuery = '';
    const target = breadcrumbs[index];
    currentFolderId = target.id;
    breadcrumbs = breadcrumbs.slice(0, index + 1);
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    try {
      await axios.post(`${API_URL}/folders`, {
        name: newFolderName.trim(),
        parentId: currentFolderId,
      });
      newFolderName = '';
      showCreateFolderInput = false;
      await loadFolders();
    } catch (err) {
      alert(`Lỗi tạo folder: ${err.response?.data?.error || err.message}`);
    }
  }

  async function handleDeleteFolder(folder, event) {
    event.stopPropagation();
    if (!confirm(`Xóa thư mục "${folder.name}" và toàn bộ file bên trong?`)) return;

    try {
      await axios.delete(`${API_URL}/folders/${folder.id}`);
      await loadFolders();
      await loadFiles(1);
    } catch (err) {
      alert(`Xóa folder thất bại: ${err.message}`);
    }
  }

  async function runRecursiveTraversal(folderId) {
    try {
      isTraversing = true;
      const res = await axios.get(`${API_URL}/folders/${folderId}/recursive`);
      recursiveData = res.data;
    } catch (err) {
      alert(`Lỗi duyệt đệ quy: ${err.response?.data?.error || err.message}`);
    } finally {
      isTraversing = false;
    }
  }

  async function uploadSingleFile(file, index) {
    try {
      uploadTasks[index].status = 'Xin URL...';

      const resUrl = await axios.post(`${API_URL}/files/upload-url`, {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
      });
      const { uploadUrl, s3Key } = resUrl.data;

      uploadTasks[index].status = 'Đang tải lên S3...';
      await axios.put(uploadUrl, file, {
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        onUploadProgress: (p) => {
          if (p.total) {
            uploadTasks[index].progress = Math.round((p.loaded * 100) / p.total);
          }
        },
      });

      uploadTasks[index].status = 'Lưu DB...';
      await axios.post(`${API_URL}/files/confirm`, {
        name: file.name,
        s3Key,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        folderId: currentFolderId,
      });

      uploadTasks[index].status = '✓ Xong';
    } catch (err) {
      uploadTasks[index].status = `❌ Lỗi: ${err.message}`;
    }
  }

  async function handleMultipleUpload(event) {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) return;

    try {
      isUploading = true;
      statusMessage = `Đang tải lên ${selectedFiles.length} mục...`;

      uploadTasks = selectedFiles.map((file) => ({
        name: file.name,
        size: file.size,
        progress: 0,
        status: 'Chờ...',
      }));

      await Promise.all(selectedFiles.map((file, idx) => uploadSingleFile(file, idx)));

      statusMessage = `✓ Đã tải lên ${selectedFiles.length} mục`;
      setTimeout(() => {
        statusMessage = '';
        uploadTasks = [];
      }, 4000);

      await loadFiles(1);
    } catch (err) {
      statusMessage = `❌ Lỗi: ${err.message}`;
    } finally {
      isUploading = false;
      event.target.value = '';
    }
  }

  async function handleDeleteFile(id, name) {
    if (!confirm(`Chuyển "${name}" vào thùng rác vĩnh viễn?`)) return;

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
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('vi-VN', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function getFileIcon(mimeType, name) {
    if (mimeType.startsWith('image/')) return { icon: '🖼️', color: '#ea4335' };
    if (mimeType.startsWith('video/')) return { icon: '🎬', color: '#ea4335' };
    if (mimeType.startsWith('audio/')) return { icon: '🎵', color: '#fbbc04' };
    if (mimeType.includes('pdf')) return { icon: '📕', color: '#ea4335' };
    if (mimeType.includes('json') || name.endsWith('.json')) return { icon: '⚙️', color: '#34a853' };
    if (mimeType.includes('javascript') || name.endsWith('.js') || name.endsWith('.ts')) return { icon: '📜', color: '#fbbc04' };
    if (name.endsWith('.html') || name.endsWith('.svelte')) return { icon: '🌐', color: '#4285f4' };
    if (name.endsWith('.css')) return { icon: '🎨', color: '#4285f4' };
    return { icon: '📄', color: '#5f6368' };
  }
</script>

<div class="gdrive-container">
  <!-- 1. HEADER CHUẨN GOOGLE DRIVE -->
  <header class="gdrive-header">
    <div class="header-left">
      <svg class="drive-logo" viewBox="0 0 87.3 78" width="36" height="32">
        <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
        <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
        <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 10.15z" fill="#ea4335"/>
        <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
        <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
        <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
      </svg>
      <span class="app-title">Drive S3</span>
    </div>

    <!-- THANH TÌM KIẾM TRUNG TÂM -->
    <div class="search-container">
      <div class="search-bar">
        <span class="search-icon">🔍</span>
        <input 
          type="text" 
          placeholder="Tìm trong Drive..." 
          bind:value={searchQuery}
        />
        {#if searchQuery}
          <button class="icon-btn-clear" onclick={() => searchQuery = ''}>✕</button>
        {/if}
      </div>
    </div>

    <div class="header-right">
      <div class="user-avatar" title="User Default">U</div>
    </div>
  </header>

  <div class="gdrive-body">
    <!-- 2. SIDEBAR TRÁI: NÚT "+ MỚI" & MENU ĐIỀU HƯỚNG -->
    <aside class="gdrive-sidebar">
      <!-- Nút "+ Mới" chuẩn Drive -->
      <div class="new-action-dropdown">
        <label class="btn-new-drive" class:disabled={isUploading}>
          <span class="plus-icon">＋</span>
          <span>Tải tệp lên</span>
          <input type="file" multiple onchange={handleMultipleUpload} disabled={isUploading} style="display: none;" />
        </label>
      </div>

      <nav class="side-nav">
        <button 
          class="nav-item" 
          class:active={currentFolderId === null && !searchQuery}
          onclick={() => { currentFolderId = null; breadcrumbs = [{ id: null, name: 'Bộ nhớ của tôi' }]; searchQuery = ''; }}
        >
          <span class="nav-icon">📁</span>
          <span class="nav-label">Bộ nhớ của tôi</span>
        </button>

        <button 
          class="nav-item dfs-item" 
          disabled={isTraversing}
          onclick={() => runRecursiveTraversal(currentFolderId ?? 'root')}
        >
          <span class="nav-icon">🔄</span>
          <span class="nav-label">
            {isTraversing ? 'Đang quét DFS...' : currentFolderId ? 'Duyệt đệ quy (Folder này)' : 'Duyệt đệ quy (Toàn bộ Root)'}
          </span>
        </button>

        <button 
          class="nav-item" 
          onclick={() => showCreateFolderInput = true}
        >
          <span class="nav-icon">➕</span>
          <span class="nav-label">Thư mục mới</span>
        </button>
      </nav>

      <!-- Dung lượng lưu trữ giả lập -->
      <div class="storage-info">
        <div class="storage-label">
          <span>Bộ nhớ</span>
          <span>{pagination.total} tệp</span>
        </div>
        <div class="storage-bar">
          <div class="storage-bar-fill" style="width: 25%;"></div>
        </div>
        <small class="storage-sub">S3 Private Bucket Direct</small>
      </div>
    </aside>

    <!-- 3. MAIN CONTENT KHÔNG GIAN LƯU TRỮ -->
    <main class="gdrive-main">
      <!-- THANH ĐIỀU HƯỚNG BREADCRUMB & TOOLBAR -->
      <div class="main-toolbar">
        <div class="breadcrumb-container">
          {#if searchQuery.trim()}
            <span class="crumb current">Kết quả tìm kiếm cho "{searchQuery}"</span>
            <button class="btn-back-root" onclick={() => searchQuery = ''}>Quay về thư mục</button>
          {:else}
            {#each breadcrumbs as crumb, i}
              <button 
                class="crumb-btn" 
                class:active={i === breadcrumbs.length - 1}
                onclick={() => goToBreadcrumb(i)}
              >
                {crumb.name}
              </button>
              {#if i < breadcrumbs.length - 1}
                <span class="crumb-arrow">›</span>
              {/if}
            {/each}
          {/if}
        </div>

        <div class="toolbar-actions">
          <!-- Chuyển đổi Grid / List -->
          <button 
            class="btn-icon" 
            class:active={viewMode === 'list'}
            title="Dạng danh sách"
            onclick={() => viewMode = 'list'}
          >
            ☰
          </button>
          <button 
            class="btn-icon" 
            class:active={viewMode === 'grid'}
            title="Dạng lưới"
            onclick={() => viewMode = 'grid'}
          >
            ⊞
          </button>
        </div>
      </div>

      <!-- MODAL/BAR TẠO FOLDER NHANH -->
      {#if showCreateFolderInput && !searchQuery}
        <div class="create-folder-dialog">
          <span class="folder-dialog-icon">📁</span>
          <input 
            type="text" 
            placeholder="Tên thư mục mới" 
            bind:value={newFolderName}
            onkeydown={(e) => e.key === 'Enter' && handleCreateFolder()}
            autofocus
          />
          <button class="btn-primary" onclick={handleCreateFolder}>Tạo</button>
          <button class="btn-secondary" onclick={() => showCreateFolderInput = false}>Hủy</button>
        </div>
      {/if}

      <div class="content-scroll">
        <!-- PHẦN 1: THƯ MỤC -->
        {#if !searchQuery.trim() && foldersList.length > 0}
          <section class="section-block">
            <h3 class="section-heading">Thư mục</h3>
            <div class="drive-folders-grid">
              {#each foldersList as folder}
                <div class="drive-folder-card" onclick={() => enterFolder(folder)}>
                  <div class="folder-card-left">
                    <span class="folder-svg-icon">📁</span>
                    <span class="folder-name-text" title={folder.name}>{folder.name}</span>
                  </div>
                  <button 
                    class="folder-menu-btn" 
                    title="Xóa thư mục" 
                    onclick={(e) => handleDeleteFolder(folder, e)}
                  >
                    ⋮
                  </button>
                </div>
              {/each}
            </div>
          </section>
        {/if}

        <!-- PHẦN 2: DANH SÁCH TỆP (FILES) -->
        <section class="section-block">
          <div class="section-header-row">
            <h3 class="section-heading">Tệp ({pagination.total})</h3>
            {#if pagination.totalPages > 1}
              <div class="pagination-controls">
                <button 
                  class="btn-page" 
                  disabled={pagination.page <= 1} 
                  onclick={() => goToPage(pagination.page - 1)}
                >‹</button>
                <span class="page-num">{pagination.page} / {pagination.totalPages}</span>
                <button 
                  class="btn-page" 
                  disabled={pagination.page >= pagination.totalPages} 
                  onclick={() => goToPage(pagination.page + 1)}
                >›</button>
              </div>
            {/if}
          </div>

          {#if filesList.length === 0}
            <div class="drive-empty">
              <div class="empty-art">📂</div>
              <p class="empty-title">{searchQuery ? 'Không tìm thấy tệp nào phù hợp' : 'Thư mục trống'}</p>
              <p class="empty-desc">{searchQuery ? 'Hãy thử tìm kiếm với từ khóa khác.' : 'Kéo thả tệp vào đây hoặc nhấn nút "Tải tệp lên"'}</p>
            </div>
          {:else if viewMode === 'grid'}
            <!-- VIEW MODE: GRID (DẠNG LƯỚI THẺ CARD CHUẨN DRIVE) -->
            <div class="drive-files-grid">
              {#each filesList as item}
                {@const iconInfo = getFileIcon(item.mimeType, item.name)}
                <div class="drive-file-card">
                  <!-- Header của card: Icon loại file + Tên file + Menu -->
                  <div class="file-card-top">
                    <span class="file-type-icon">{iconInfo.icon}</span>
                    <span class="file-name" title={item.name}>{item.name}</span>
                    <button class="file-delete-icon" title="Xóa file" onclick={() => handleDeleteFile(item.id, item.name)}>
                      🗑️
                    </button>
                  </div>

                  <!-- Thân preview của card -->
                  <a href={item.presignedUrl} target="_blank" class="file-preview-area" rel="noreferrer">
                    {#if item.mimeType.startsWith('image/')}
                      <img src={item.presignedUrl} alt={item.name} loading="lazy" />
                    {:else}
                      <div class="large-icon-placeholder">{iconInfo.icon}</div>
                    {/if}
                  </a>

                  <!-- Footer của card: Dung lượng -->
                  <div class="file-card-bottom">
                    <span class="file-size-tag">{formatBytes(item.size)}</span>
                    <a href={item.presignedUrl} target="_blank" class="link-open-direct" title="Xem chi tiết" rel="noreferrer">
                      Mở ↗
                    </a>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <!-- VIEW MODE: LIST (DẠNG BẢNG DANH SÁCH DRIVE) -->
            <div class="drive-table-container">
              <table class="drive-table">
                <thead>
                  <tr>
                    <th class="col-name">Tên</th>
                    <th class="col-owner">Chủ sở hữu</th>
                    <th class="col-date">Ngày tải lên</th>
                    <th class="col-size">Kích cỡ tệp</th>
                    <th class="col-actions">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {#each filesList as item}
                    {@const iconInfo = getFileIcon(item.mimeType, item.name)}
                    <tr class="table-row-item">
                      <td class="col-name">
                        <div class="table-name-cell">
                          <span class="row-icon">{iconInfo.icon}</span>
                          <a href={item.presignedUrl} target="_blank" class="table-file-link" rel="noreferrer">
                            {item.name}
                          </a>
                        </div>
                      </td>
                      <td class="col-owner">tôi</td>
                      <td class="col-date">{formatDate(item.createdAt)}</td>
                      <td class="col-size">{formatBytes(item.size)}</td>
                      <td class="col-actions">
                        <div class="table-action-btns">
                          <a href={item.presignedUrl} target="_blank" class="action-btn-circle" title="Mở file" rel="noreferrer">
                            ↗
                          </a>
                          <button class="action-btn-circle danger" title="Xóa file" onclick={() => handleDeleteFile(item.id, item.name)}>
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </section>
      </div>
    </main>
  </div>

  <!-- TIẾN TRÌNH UPLOAD NỔI GÓC DƯỚI PHẢI (CHUẨN G-DRIVE UPLOAD DOCK) -->
  {#if uploadTasks.length > 0}
    <div class="upload-dock">
      <div class="dock-header">
        <span>{statusMessage}</span>
        <button class="dock-close" onclick={() => uploadTasks = []}>✕</button>
      </div>
      <div class="dock-list">
        {#each uploadTasks as task}
          <div class="dock-item">
            <div class="dock-item-info">
              <span class="dock-name" title={task.name}>{task.name}</span>
              <span class="dock-pct">{task.status}</span>
            </div>
            <div class="dock-bar-track">
              <div class="dock-bar-fill" style="width: {task.progress}%;"></div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- MODAL DFS TRAVERSAL -->
  {#if recursiveData}
    <div class="modal-backdrop" onclick={() => recursiveData = null}>
      <div class="modal-window" onclick={(e) => e.stopPropagation()}>
        <div class="modal-win-header">
          <div class="win-title-wrap">
            <h3>⚡ Duyệt Cây Thư Mục Đệ Quy (DFS)</h3>
            <span class="win-stats">
              {recursiveData.totalFoldersTraversed} thư mục • {recursiveData.totalFiles} tệp • {formatBytes(recursiveData.totalSize)} • Thuật toán hoàn tất trong <strong>{recursiveData.executionTimeMs} ms</strong>
            </span>
          </div>
          <button class="btn-win-close" onclick={() => recursiveData = null}>✕</button>
        </div>

        <div class="modal-win-body">
          <table class="dfs-table">
            <thead>
              <tr>
                <th>Đường dẫn phân cấp (Virtual Path)</th>
                <th>Tên tệp</th>
                <th>Dung lượng</th>
              </tr>
            </thead>
            <tbody>
              {#each recursiveData.files as rf}
                <tr>
                  <td class="dfs-path">📁 {rf.folderPath}</td>
                  <td class="dfs-filename">📄 {rf.name}</td>
                  <td>{formatBytes(rf.size)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <div class="modal-win-footer">
          <button class="btn-primary" onclick={() => recursiveData = null}>Đóng</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: 'Google Sans', Roboto, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    background: #f8fafd;
    color: #1f1f1f;
    overflow: hidden;
  }

  .gdrive-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
  }

  /* 1. HEADER */
  .gdrive-header {
    height: 54px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background: #f8fafd;
    border-bottom: 1px solid #e1e3e1;
    box-sizing: border-box;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 200px;
  }
  .app-title {
    font-size: 18px;
    color: #444746;
    font-weight: 500;
  }

  .search-container {
    flex: 1;
    max-width: 680px;
  }
  .search-bar {
    display: flex;
    align-items: center;
    background: #edf2fc;
    border-radius: 24px;
    height: 40px;
    padding: 0 14px;
    position: relative;
    transition: background 0.2s, box-shadow 0.2s;
  }
  .search-bar:focus-within {
    background: #ffffff;
    box-shadow: 0 1px 3px 1px rgba(60,64,67,0.15), 0 1px 2px 0 rgba(60,64,67,0.30);
  }
  .search-icon {
    font-size: 15px;
    color: #444746;
    margin-right: 10px;
  }
  .search-bar input {
    border: none;
    background: transparent;
    width: 100%;
    font-size: 14px;
    color: #1f1f1f;
    outline: none;
  }
  .icon-btn-clear {
    border: none;
    background: transparent;
    color: #5f6368;
    cursor: pointer;
    font-size: 14px;
    padding: 2px;
  }

  .header-right {
    display: flex;
    align-items: center;
  }
  .user-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #1a73e8;
    color: white;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
  }

  /* 2. BODY LAYOUT */
  .gdrive-body {
    display: flex;
    flex: 1;
    height: calc(100vh - 54px);
    overflow: hidden;
  }

  /* SIDEBAR */
  .gdrive-sidebar {
    width: 200px;
    background: #f8fafd;
    padding: 12px 8px;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    gap: 10px;
  }

  .btn-new-drive {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: #ffffff;
    color: #1f1f1f;
    box-shadow: 0 1px 3px 0 rgba(60,64,67,0.25);
    padding: 10px 16px;
    border-radius: 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: box-shadow 0.2s, background 0.2s;
    user-select: none;
  }
  .btn-new-drive:hover {
    background: #f1f3f4;
    box-shadow: 0 2px 6px rgba(60,64,67,0.2);
  }
  .plus-icon {
    font-size: 18px;
    font-weight: 700;
    color: #1a73e8;
  }

  .side-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 18px;
    border: none;
    background: transparent;
    color: #444746;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s;
  }
  .nav-item:hover {
    background: #eaebef;
  }
  .nav-item.active {
    background: #c2e7ff;
    color: #001d35;
    font-weight: 600;
  }
  .nav-item.dfs-item {
    color: #7c3aed;
  }
  .nav-icon {
    font-size: 16px;
  }

  .storage-info {
    margin-top: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .storage-label {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: #444746;
  }
  .storage-bar {
    width: 100%;
    height: 4px;
    background: #e1e3e1;
    border-radius: 2px;
    overflow: hidden;
  }
  .storage-bar-fill {
    height: 100%;
    background: #1a73e8;
  }
  .storage-sub {
    font-size: 11px;
    color: #747775;
  }

  /* MAIN CONTENT */
  .gdrive-main {
    flex: 1;
    background: #ffffff;
    border-radius: 12px 0 0 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: -1px -1px 3px rgba(0,0,0,0.02);
  }

  .main-toolbar {
    height: 46px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    border-bottom: 1px solid #f1f3f4;
  }

  .breadcrumb-container {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 15px;
    font-weight: 500;
    color: #1f1f1f;
  }
  .crumb-btn {
    border: none;
    background: transparent;
    font-size: 15px;
    color: #444746;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .crumb-btn:hover { background: #f1f3f4; color: #1f1f1f; }
  .crumb-btn.active { color: #1f1f1f; font-weight: 600; cursor: default; }
  .crumb-arrow { color: #80868b; font-size: 14px; }
  .btn-back-root {
    margin-left: 8px;
    background: #f1f3f4;
    border: none;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
    color: #1a73e8;
    cursor: pointer;
  }

  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .btn-icon {
    background: transparent;
    border: 1px solid transparent;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    cursor: pointer;
    font-size: 15px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #444746;
  }
  .btn-icon:hover { background: #f1f3f4; }
  .btn-icon.active { background: #e3e3e3; color: #1f1f1f; }

  .create-folder-dialog {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 16px 0 16px;
    padding: 8px 12px;
    background: #edf2fc;
    border-radius: 8px;
    border: 1px solid #c2e7ff;
  }
  .create-folder-dialog input {
    flex: 1;
    border: 1px solid #c4c7c5;
    background: #ffffff;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 13px;
    outline: none;
  }
  .btn-primary {
    background: #1a73e8;
    color: white;
    border: none;
    padding: 6px 14px;
    border-radius: 14px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .btn-secondary {
    background: transparent;
    border: none;
    color: #444746;
    padding: 6px 10px;
    font-size: 13px;
    cursor: pointer;
  }

  .content-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .section-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .section-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .section-heading {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: #444746;
    letter-spacing: 0.2px;
  }

  /* THƯ MỤC GỌN GÀNG */
  .drive-folders-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 8px;
  }
  .drive-folder-card {
    background: #f0f4f9;
    border-radius: 8px;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    transition: background 0.15s;
    border: 1px solid transparent;
  }
  .drive-folder-card:hover {
    background: #e3e8ee;
    border-color: #cbd5e1;
  }
  .folder-card-left {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
  }
  .folder-svg-icon { font-size: 17px; }
  .folder-name-text {
    font-size: 13px;
    font-weight: 500;
    color: #1f1f1f;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .folder-menu-btn {
    border: none;
    background: transparent;
    font-size: 14px;
    color: #5f6368;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
  }
  .folder-menu-btn:hover { background: #d0d7de; color: #d93025; }

  /* DRIVE GRID FILES: TẬP TRUNG, TỐI ƯU KHÔNG GIAN */
  .drive-files-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }
  .drive-file-card {
    background: #f0f4f9;
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    border: 1px solid #e1e3e1;
    transition: box-shadow 0.15s, background 0.15s;
  }
  .drive-file-card:hover {
    background: #e9eef6;
    box-shadow: 0 1px 4px rgba(60,64,67,0.18);
  }
  .file-card-top {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px 6px 10px;
  }
  .file-type-icon { font-size: 16px; }
  .file-name {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
    color: #1f1f1f;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .file-delete-icon {
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 2px;
    font-size: 12px;
    opacity: 0.6;
  }
  .file-delete-icon:hover { opacity: 1; color: #d93025; }

  .file-preview-area {
    height: 110px;
    background: #ffffff;
    margin: 0 6px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    text-decoration: none;
  }
  .file-preview-area img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .large-icon-placeholder {
    font-size: 38px;
  }

  .file-card-bottom {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
  }
  .file-size-tag {
    font-size: 11px;
    color: #5f6368;
  }
  .link-open-direct {
    font-size: 11px;
    color: #1a73e8;
    text-decoration: none;
    font-weight: 500;
  }

  /* DRIVE LIST VIEW (TABLE) */
  .drive-table-container {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e1e3e1;
    overflow: hidden;
  }
  .drive-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    text-align: left;
  }
  .drive-table th {
    padding: 12px 16px;
    color: #444746;
    font-weight: 500;
    border-bottom: 1px solid #e1e3e1;
    background: #f8fafd;
  }
  .drive-table td {
    padding: 12px 16px;
    border-bottom: 1px solid #f1f3f4;
    color: #1f1f1f;
  }
  .table-row-item:hover {
    background: #f0f4f9;
  }
  .table-name-cell {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .row-icon { font-size: 18px; }
  .table-file-link {
    color: #1f1f1f;
    text-decoration: none;
    font-weight: 500;
    max-width: 320px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: inline-block;
  }
  .table-file-link:hover { text-decoration: underline; color: #1a73e8; }
  .col-owner, .col-date, .col-size { color: #5f6368; }
  .table-action-btns {
    display: flex;
    gap: 8px;
  }
  .action-btn-circle {
    border: none;
    background: #ffffff;
    border: 1px solid #c4c7c5;
    border-radius: 50%;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    text-decoration: none;
    color: #444746;
    font-size: 12px;
  }
  .action-btn-circle:hover { background: #f1f3f4; }
  .action-btn-circle.danger:hover { color: #d93025; border-color: #d93025; }

  /* PAGINATION CONTROLS */
  .pagination-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .btn-page {
    border: 1px solid #c4c7c5;
    background: #ffffff;
    border-radius: 50%;
    width: 28px;
    height: 28px;
    cursor: pointer;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #444746;
  }
  .btn-page:disabled { opacity: 0.4; cursor: not-allowed; }
  .page-num { font-size: 13px; color: #5f6368; }

  /* EMPTY STATE */
  .drive-empty {
    padding: 60px 0;
    text-align: center;
  }
  .empty-art { font-size: 56px; margin-bottom: 12px; }
  .empty-title { font-size: 18px; font-weight: 500; color: #1f1f1f; margin: 0 0 6px 0; }
  .empty-desc { font-size: 14px; color: #5f6368; margin: 0; }

  /* UPLOAD DOCK (BOTTOM RIGHT CHUẨN DRIVE) */
  .upload-dock {
    position: fixed;
    bottom: 16px;
    right: 24px;
    width: 360px;
    background: #ffffff;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    border-radius: 12px;
    overflow: hidden;
    z-index: 100;
  }
  .dock-header {
    background: #1f1f1f;
    color: white;
    padding: 12px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 14px;
    font-weight: 500;
  }
  .dock-close {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    font-size: 14px;
  }
  .dock-list {
    max-height: 220px;
    overflow-y: auto;
    padding: 8px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .dock-item-info {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    margin-bottom: 4px;
  }
  .dock-name {
    max-width: 220px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }
  .dock-pct { color: #5f6368; }
  .dock-bar-track {
    width: 100%;
    height: 4px;
    background: #e1e3e1;
    border-radius: 2px;
    overflow: hidden;
  }
  .dock-bar-fill {
    height: 100%;
    background: #1a73e8;
    transition: width 0.2s;
  }

  /* MODAL DFS */
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }
  .modal-window {
    background: white;
    border-radius: 16px;
    width: 780px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 12px 32px rgba(0,0,0,0.25);
    overflow: hidden;
  }
  .modal-win-header {
    padding: 16px 20px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 1px solid #e1e3e1;
  }
  .win-title-wrap h3 { margin: 0 0 4px 0; font-size: 18px; color: #1f1f1f; }
  .win-stats { font-size: 13px; color: #5f6368; }
  .btn-win-close { background: none; border: none; font-size: 18px; cursor: pointer; color: #5f6368; }
  .modal-win-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
  }
  .dfs-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .dfs-table th {
    text-align: left;
    padding: 8px 12px;
    background: #f8fafd;
    border-bottom: 1px solid #e1e3e1;
    color: #444746;
  }
  .dfs-table td {
    padding: 8px 12px;
    border-bottom: 1px solid #f1f3f4;
  }
  .dfs-path { color: #1a73e8; font-weight: 500; font-family: monospace; }
  .dfs-filename { font-weight: 500; }
  .modal-win-footer {
    padding: 12px 20px;
    border-top: 1px solid #e1e3e1;
    display: flex;
    justify-content: flex-end;
  }
</style>