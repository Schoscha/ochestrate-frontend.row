document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('status');
  const threadsContainer = document.getElementById('threads-list');
  const chatMessages = document.getElementById('chat-messages');
  const promptEl = document.getElementById('prompt');
  const sendBtn = document.getElementById('send-btn');
  const interruptBtn = document.getElementById('interrupt-btn');
  const wissenSearch = document.getElementById('wissen-search');
  const wissenResults = document.getElementById('wissen-results');

  let sseClient = null;
  let currentThread = null;
  let isConnected = false;

  // Status indicator
  const updateStatus = (status, connected) => {
    statusEl.textContent = status;
    statusEl.className = '';
    isConnected = connected;
    if (connected) {
      statusEl.classList.add('connected');
    } else {
      statusEl.classList.add('disconnected');
    }
    sendBtn.disabled = !connected;
    if (connected && currentThread) {
      interruptBtn.classList.add('visible');
      interruptBtn.style.display = 'inline';
    } else {
      interruptBtn.classList.remove('visible');
      interruptBtn.style.display = 'none';
    }
  };

  // Load threads
  const loadThreads = async () => {
    try {
      const response = await fetch('/api/threads');
      const data = await response.json();
      if (data.error) {
        threadsContainer.innerHTML = `<div class="error">Fehler: ${data.error}</div>`;
        return;
      }
      // Handle different response shapes: { threads: [...] }, { items: [...] }, or direct array
      const threads = data.threads || data.items || (Array.isArray(data) ? data : []);
      if (!threads.length) {
        threadsContainer.innerHTML = '<div class="empty">Keine Threads gefunden</div>';
        return;
      }
      threadsContainer.innerHTML = threads.map(thread => `
        <div class="thread-item" data-thread-id="${thread.id || thread.thread_id}">
          <strong>${thread.title || thread.name || 'Untitled'}</strong>
          <small>${thread.created_at || thread.createdAt || thread.updated_at || 'Kein Datum'}</small>
        </div>
      `).join('');

      document.querySelectorAll('.thread-item').forEach(item => {
        item.addEventListener('click', () => {
          loadThread(item.dataset.threadId);
        });
      });
    } catch (err) {
      threadsContainer.innerHTML = `<div class="error">Fehler beim Laden der Threads: ${err.message}</div>`;
    }
  };

  // Load a specific thread
  const loadThread = async (threadId) => {
    try {
      currentThread = threadId;
      updateStatus('Lade Thread...', isConnected);

      const response = await fetch(`/api/threads/${threadId}/turns`);
      const data = await response.json();

      if (data.error) {
        chatMessages.innerHTML = `<div class="error">Fehler: ${data.error}</div>`;
        return;
      }
      // Handle different response shapes
      const turns = data.turns || data.items || (Array.isArray(data) ? data : []);
      chatMessages.innerHTML = '';
      turns.forEach(turn => {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${turn.role === 'user' ? 'user' : 'agent'}`;
        msgDiv.textContent = turn.text || turn.content || JSON.stringify(turn);
        chatMessages.appendChild(msgDiv);
      });

      updateStatus('Thread geladen', true);
    } catch (err) {
      chatMessages.innerHTML = `<div class="error">Fehler: ${err.message}</div>`;
      updateStatus('Thread Laden fehlgeschlagen', false);
    }
  };

  // SSE connection
  const connectSSE = () => {
    if (sseClient) return;

    const eventSource = new EventSource('/api/events');
    sseClient = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Server sends { method: 'events/...', params: {...} } or { type: 'connected' }
        const method = data.method || '';
        const params = data.params || data;
        const type = data.type || method.replace('events/', '');

        if (type === 'connected') {
          updateStatus('Verbunden', true);
        } else if (type === 'turnStarted' || type === 'turnCompleted') {
          const turn = params.turn || params;
          const msgDiv = document.createElement('div');
          msgDiv.className = 'message agent';
          msgDiv.textContent = 'Agent: ' + (turn.text || turn.content || JSON.stringify(turn));
          chatMessages.appendChild(msgDiv);
          chatMessages.scrollTop = chatMessages.scrollHeight;
        } else if (type === 'itemStarted' || type === 'itemCompleted') {
          const item = params.item || params;
          const msgDiv = document.createElement('div');
          msgDiv.className = 'message';
          msgDiv.innerHTML = `<strong>Wissen:</strong> ${item.name || item.title || '...'}`;
          wissenResults.appendChild(msgDiv);
        }
      } catch (e) {
        console.warn('SSE parse error', e, event.data);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE Error:', error);
      updateStatus('SSE Verbindung verloren', false);
      eventSource.close();
      sseClient = null;
      setTimeout(connectSSE, 3000);
    };
  };

  // Send message
  const sendMessage = async () => {
    const text = promptEl.value.trim();
    if (!text || !isConnected) return;

    updateStatus('Sende Nachricht...', true);

    try {
      const response = await fetch('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-6.1-sol',
          prompt: text
        })
      });

      const data = await response.json();
      if (data.error) {
        updateStatus(`Fehler: ${data.error}`, true);
      } else {
        currentThread = data.id || data.thread_id;
        updateStatus('Verstanden', true);
        promptEl.value = '';
        // Reload threads to show new one
        loadThreads();
      }
    } catch (err) {
      updateStatus(`Fehler: ${err.message}`, true);
    }
  };

  // Interrupt
  const interrupt = async () => {
    if (!currentThread) return;

    updateStatus('Unterbrechung...', true);

    try {
      await fetch('/api/interrupt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: currentThread })
      });
      updateStatus('Unterbrochen', true);
    } catch (err) {
      updateStatus(`Fehler: ${err.message}`, true);
    }
  };

  // Wissen suchen
  const searchWissen = async () => {
    const query = wissenSearch.value.trim();
    if (!query) return;

    wissenResults.innerHTML = 'Lade Wissen...';

    try {
      const response = await fetch(`/api/wissen?q=${encodeURIComponent(query)}&limit=5`);
      const data = await response.json();

      if (data.error) {
        wissenResults.innerHTML = `<div class="error">Fehler: ${data.error}</div>`;
        return;
      }

      const results = data.results || data.items || (Array.isArray(data) ? data : []);
      if (!results.length) {
        wissenResults.innerHTML = '<div class="empty">Keine Treffer</div>';
        return;
      }

      wissenResults.innerHTML = results.map(item => `
        <div class="wissen-item">
          <strong>${item.title}</strong>
          <small>${item.description || 'Keine Beschreibung'}</small>
        </div>
      `).join('');
    } catch (err) {
      wissenResults.innerHTML = `<div class="error">Fehler beim Suchen: ${err.message}</div>`;
    }
  };

  // Event listeners
  sendBtn.addEventListener('click', sendMessage);
  interruptBtn.addEventListener('click', interrupt);
  promptEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  wissenSearch.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchWissen();
  });

  // Initial load
  updateStatus('Verbinden...', false);
  connectSSE();
  loadThreads();
});