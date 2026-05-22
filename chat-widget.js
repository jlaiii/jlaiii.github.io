(function() {
  'use strict';

  const BACKEND_URL = 'http://65.75.202.18:8001';
  const AUTO_TRIGGER_DELAY = 8000; // ms
  const POLL_INTERVAL = 2000; // ms for live chat polling

  // ----- State -----
  let panelOpen = false;
  let mode = 'ai'; // 'ai' | 'live' | 'contact'
  let liveSessionId = null;
  let lastMessageId = 0;
  let pollTimer = null;
  let messageHistory = [];
  let awaitingContact = false; // true when bot asked for contact info
  let pendingContactData = {};

  // ----- Inject styles -----
  function injectStyles() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://jlaiii.github.io/chat-widget.css';
    link.id = 'jc-styles';
    document.head.appendChild(link);
  }

  // ----- Build DOM -----
  function buildWidget() {
    const container = document.createElement('div');
    container.id = 'jc-container';

    // FAB
    const fab = document.createElement('button');
    fab.id = 'jc-fab';
    fab.innerHTML = '💬';
    fab.title = 'Chat with Jay\'s AI assistant';
    container.appendChild(fab);

    // Toast
    const toast = document.createElement('div');
    toast.id = 'jc-toast';
    toast.innerHTML = '<button id="jc-toast-close">✕</button><div>👋 <strong>Hey, I\'m Jay\'s AI assistant!</strong><br>Ask me anything about Jay, his skills, or how to hire him.</div>';
    container.appendChild(toast);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'jc-panel';

    // Header
    const header = document.createElement('div');
    header.id = 'jc-header';
    header.innerHTML = `
      <div>
        <div id="jc-header-title">🤖 Jay\'s AI Assistant</div>
        <div id="jc-header-status">Online — ask me anything</div>
      </div>
      <div id="jc-header-actions">
        <button id="jc-back-btn" title="Back">←</button>
        <button id="jc-minimize-btn" title="Minimize">─</button>
      </div>
    `;
    panel.appendChild(header);

    // Connect status (for live mode)
    const connectStatus = document.createElement('div');
    connectStatus.id = 'jc-connect-status';
    connectStatus.style.display = 'none';
    panel.appendChild(connectStatus);

    // Messages
    const messages = document.createElement('div');
    messages.id = 'jc-messages';
    panel.appendChild(messages);

    // Contact form
    const contactForm = document.createElement('div');
    contactForm.id = 'jc-contact-form';
    contactForm.innerHTML = `
      <h3>📩 Send a Message to Jay</h3>
      <input type="text" id="jc-cf-name" placeholder="Your name">
      <input type="email" id="jc-cf-email" placeholder="Your email">
      <textarea id="jc-cf-msg" placeholder="What would you like to tell Jay?"></textarea>
      <button id="jc-cf-submit">Send Message</button>
      <button id="jc-cf-back">← Back to chat</button>
    `;
    panel.appendChild(contactForm);

    // Input
    const inputArea = document.createElement('div');
    inputArea.id = 'jc-input-area';
    inputArea.innerHTML = `
      <textarea id="jc-input" placeholder="Type a message..." rows="1"></textarea>
      <button id="jc-send" disabled>➤</button>
    `;
    panel.appendChild(inputArea);

    container.appendChild(panel);
    document.body.appendChild(container);
  }

  // ----- Helpers -----
  function get(id) { return document.getElementById(id); }

  function addMessage(text, type) {
    const el = document.createElement('div');
    el.className = 'jc-msg jc-' + type;
    el.textContent = text;
    get('jc-messages').appendChild(el);
    get('jc-messages').scrollTop = get('jc-messages').scrollHeight;
  }

  function showTyping() {
    const el = document.createElement('div');
    el.className = 'jc-typing';
    el.id = 'jc-typing-indicator';
    el.innerHTML = '<span></span><span></span><span></span>';
    get('jc-messages').appendChild(el);
    get('jc-messages').scrollTop = get('jc-messages').scrollHeight;
  }

  function hideTyping() {
    const el = get('jc-typing-indicator');
    if (el) el.remove();
  }

  function setStatus(text, className) {
    const el = get('jc-connect-status');
    el.style.display = 'block';
    el.textContent = text;
    el.className = className || '';
  }

  function hideStatus() {
    get('jc-connect-status').style.display = 'none';
  }

  function setInputEnabled(enabled) {
    get('jc-input').disabled = !enabled;
    get('jc-send').disabled = !enabled;
  }

  function isUrl(str) {
    return str.startsWith('http://') || str.startsWith('https://');
  }

  // ----- API calls -----
  async function callAI(message) {
    const resp = await fetch(BACKEND_URL + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message,
        history: messageHistory,
      }),
    });
    if (!resp.ok) throw new Error('AI chat error: ' + resp.status);
    const data = await resp.json();
    return data.response;
  }

  async function startLiveChat(message) {
    const resp = await fetch(BACKEND_URL + '/chat/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: '', message: message }),
    });
    if (!resp.ok) throw new Error('Live chat start error: ' + resp.status);
    const data = await resp.json();
    liveSessionId = data.session_id;
    lastMessageId = 0;
    return data;
  }

  async function sendLiveMessage(message) {
    const resp = await fetch(BACKEND_URL + '/chat/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: liveSessionId, message: message }),
    });
    if (!resp.ok) throw new Error('Live chat send error: ' + resp.status);
    return resp.json();
  }

  async function pollLive() {
    if (!liveSessionId) return;
    try {
      const resp = await fetch(BACKEND_URL + '/chat/live/' + liveSessionId + '/poll?last_id=' + lastMessageId);
      if (!resp.ok) throw new Error('Poll error: ' + resp.status);
      const data = await resp.json();
      if (data.messages && data.messages.length) {
        for (const msg of data.messages) {
          if (msg.from === 'jay') {
            addMessage(msg.text, 'bot');
            lastMessageId = Math.max(lastMessageId, msg.id);
          }
        }
      }
      if (data.connected) {
        setStatus('✅ Jay is here ✓', 'jc-connected');
      }
      if (data.closed) {
        stopPolling();
        addMessage('This chat has been closed.', 'system');
        setInputEnabled(false);
      }
    } catch (e) {
      console.error('Poll error:', e);
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(pollLive, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function sendContact(name, email, message) {
    const resp = await fetch(BACKEND_URL + '/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, email: email, message: message }),
    });
    if (!resp.ok) throw new Error('Contact error: ' + resp.status);
    return resp.json();
  }

  // ----- Mode switching -----
  function switchToLive() {
    mode = 'live';
    setStatus('🔗 Connecting to Jay...', 'jc-connecting jc-pulse');
    get('jc-header-title').textContent = '💬 Live Chat with Jay';
    get('jc-header-status').textContent = 'Connecting...';
    get('jc-back-btn').style.display = 'inline-block';
    startPolling();
  }

  function switchToAI() {
    mode = 'ai';
    stopPolling();
    hideStatus();
    liveSessionId = null;
    get('jc-header-title').textContent = '🤖 Jay\'s AI Assistant';
    get('jc-header-status').textContent = 'Online — ask me anything';
    get('jc-back-btn').style.display = 'none';
  }

  function switchToContact() {
    mode = 'contact';
    get('jc-contact-form').classList.add('show');
    get('jc-input-area').style.display = 'none';
    get('jc-header-title').textContent = '📩 Contact Jay';
    get('jc-header-status').textContent = '';
    get('jc-back-btn').style.display = 'inline-block';
  }

  function switchFromContact() {
    mode = 'ai';
    get('jc-contact-form').classList.remove('show');
    get('jc-input-area').style.display = 'flex';
    get('jc-header-title').textContent = '🤖 Jay\'s AI Assistant';
    get('jc-header-status').textContent = 'Online — ask me anything';
    get('jc-back-btn').style.display = 'none';
  }

  // ----- Handle user message -----
  async function handleSend() {
    const input = get('jc-input');
    const text = input.value.trim();
    if (!text) return;

    // Contact mode — capture info
    if (awaitingContact) {
      handleContactCapture(text);
      input.value = '';
      return;
    }

    input.value = '';
    input.style.height = 'auto';

    addMessage(text, 'user');
    messageHistory.push({ role: 'user', content: text });

    // Check if they want live chat
    const liveKeywords = ['connect me to jay', 'talk to jay', 'live chat', 'connect me', 'talk to him', 'i want to talk', 'connect with jay', 'live'];
    const wantsLive = liveKeywords.some(k => text.toLowerCase().includes(k));
    const wantsContact = text.toLowerCase().includes('contact') || text.toLowerCase().includes('message jay') || text.toLowerCase().includes('get in touch') || text.toLowerCase().includes('hire');

    if (wantsLive && mode === 'ai') {
      showTyping();
      try {
        const result = await startLiveChat(text);
        hideTyping();
        addMessage('Great! Connecting you to Jay now. Give me a moment...', 'bot');
        switchToLive();
        await pollLive(); // Immediate poll
        startPolling();
      } catch (e) {
        hideTyping();
        addMessage('Sorry, something went wrong starting the live chat. Try again?', 'bot');
      }
      messageHistory = [];
      return;
    }

    // Normal AI chat
    showTyping();
    try {
      const response = await callAI(text);
      hideTyping();
      addMessage(response, 'bot');
      messageHistory.push({ role: 'assistant', content: response });

      // If the bot asked for contact info, set awaitingContact flag
      const askKeywords = ['your name', 'your email', 'what\'s your name', 'tell me your name', 'name and email'];
      const isAsking = askKeywords.some(k => response.toLowerCase().includes(k))
        && (text.toLowerCase().includes('contact') || text.toLowerCase().includes('message') || response.toLowerCase().includes('name') && response.toLowerCase().includes('email'));
      if (isAsking) {
        awaitingContact = true;
        pendingContactData = {};
      }
    } catch (e) {
      hideTyping();
      addMessage('Sorry, something went wrong. Please try again.', 'bot');
    }
  }

  function handleContactCapture(text) {
    if (!pendingContactData.name) {
      pendingContactData.name = text;
      addMessage('Thanks! And your email?', 'bot');
      return;
    }
    if (!pendingContactData.email) {
      // Validate email roughly
      if (text.includes('@') && text.includes('.')) {
        pendingContactData.email = text;
        addMessage('Great! And what message would you like to send to Jay?', 'bot');
        return;
      } else {
        addMessage('That doesn\'t look like a valid email. Could you try again?', 'bot');
        return;
      }
    }
    if (!pendingContactData.message) {
      pendingContactData.message = text;
      awaitingContact = false;
      // Send to backend
      showTyping();
      sendContact(
        pendingContactData.name,
        pendingContactData.email,
        pendingContactData.message,
      ).then(() => {
        hideTyping();
        addMessage('✅ Your message has been sent to Jay! He\'ll get back to you soon.', 'bot');
        pendingContactData = {};
      }).catch(() => {
        hideTyping();
        addMessage('Sorry, something went wrong sending your message. Please try the contact form.', 'bot');
      });
      return;
    }
  }

  // ----- Event listeners -----
  function initEvents() {
    const fab = get('jc-fab');
    const toast = get('jc-toast');
    const panel = get('jc-panel');
    const minimizeBtn = get('jc-minimize-btn');
    const backBtn = get('jc-back-btn');
    const sendBtn = get('jc-send');
    const input = get('jc-input');
    const toastClose = get('jc-toast-close');

    // FAB click
    fab.addEventListener('click', function(e) {
      panelOpen = !panelOpen;
      panel.classList.toggle('open', panelOpen);
      fab.innerHTML = panelOpen ? '✕' : '💬';
      toast.classList.remove('show');
      if (panelOpen) {
        get('jc-input').focus();
      }
    });

    // Toast
    toast.addEventListener('click', function() {
      toast.classList.remove('show');
      panelOpen = true;
      panel.classList.add('open');
      fab.innerHTML = '✕';
      get('jc-input').focus();
    });
    toastClose.addEventListener('click', function(e) {
      e.stopPropagation();
      toast.classList.remove('show');
    });

    // Auto-trigger toast
    setTimeout(function() {
      if (!panelOpen) {
        toast.classList.add('show');
      }
    }, AUTO_TRIGGER_DELAY);

    // Minimize
    minimizeBtn.addEventListener('click', function() {
      panelOpen = false;
      panel.classList.remove('open');
      fab.innerHTML = '💬';
    });

    // Back button
    backBtn.addEventListener('click', function() {
      if (mode === 'contact') {
        switchFromContact();
      } else if (mode === 'live') {
        // Switch back to AI, but live chat still active in background
        switchToAI();
        addMessage('You\'re back in AI mode. Live chat is still connected in the background.', 'system');
        setInputEnabled(true);
      }
    });

    // Send
    sendBtn.addEventListener('click', handleSend);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
    input.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      get('jc-send').disabled = !this.value.trim();
    });

    // Contact form
    get('jc-cf-submit').addEventListener('click', async function() {
      const name = get('jc-cf-name').value.trim();
      const email = get('jc-cf-email').value.trim();
      const msg = get('jc-cf-msg').value.trim();
      if (!name || !email || !msg) return;

      this.disabled = true;
      this.textContent = 'Sending...';
      try {
        await sendContact(name, email, msg);
        this.textContent = '✅ Sent!';
        setTimeout(() => {
          switchFromContact();
          addMessage('✅ Your message has been sent to Jay! He\'ll get back to you soon.', 'bot');
          get('jc-cf-name').value = '';
          get('jc-cf-email').value = '';
          get('jc-cf-msg').value = '';
          this.disabled = false;
          this.textContent = 'Send Message';
        }, 1000);
      } catch (e) {
        this.textContent = '❌ Error — try again';
        this.disabled = false;
      }
    });
    get('jc-cf-back').addEventListener('click', switchFromContact);
  }

  // ----- Init -----
  function init() {
    if (document.getElementById('jc-container')) return; // Already loaded
    buildWidget();
    initEvents();
  }

  // Load on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
