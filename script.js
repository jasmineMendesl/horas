const HOUR_VALUE = 60;
const GOAL_HOURS = 176;
const STORAGE_KEY = 'hourCounterEntries';
const SPREADSHEET_API_URL = 'https://script.google.com/macros/s/AKfycbxvnESpg2ImihYg3TNDM03vYmcGQV50tNqeK9FHJ297KYlCXNMc_pYgl7dh_eGzM-Mp/exec';

const form = document.querySelector('#hours-form');
const hoursInput = document.querySelector('#hours-input');
const descriptionInput = document.querySelector('#description-input');
const jiraInput = document.querySelector('#jira-input');
const workedHours = document.querySelector('#worked-hours');
const earnedValue = document.querySelector('#earned-value');
const remainingHours = document.querySelector('#remaining-hours');
const remainingValue = document.querySelector('#remaining-value');
const progressPercent = document.querySelector('#progress-percent');
const progressFill = document.querySelector('#progress-fill');
const statusMessage = document.querySelector('#status-message');
const historyList = document.querySelector('#history-list');
const clearButton = document.querySelector('#clear-button');
const storageStatus = document.querySelector('#storage-status');
const syncStatus = document.querySelector('#sync-status');

let entries = [];
let isSyncing = false;

const inputError = document.createElement('p');
inputError.className = 'input-error';
inputError.setAttribute('role', 'alert');
form.appendChild(inputError);

function hasSpreadsheetApi() {
  return SPREADSHEET_API_URL.trim().length > 0;
}

function createEntryId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeEntry(entry) {
  return {
    id: entry.id || createEntryId(),
    hours: Number(entry.hours),
    date: entry.date || '',
    description: entry.description || '',
    jiraLink: entry.jiraLink || ''
  };
}

function normalizeEntries(rawEntries) {
  if (!Array.isArray(rawEntries)) {
    return [];
  }

  return rawEntries
    .map(normalizeEntry)
    .filter((entry) => Number.isFinite(entry.hours) && entry.hours > 0);
}

function loadLocalEntries() {
  const savedEntries = localStorage.getItem(STORAGE_KEY);

  if (!savedEntries) {
    return [];
  }

  try {
    const parsedEntries = JSON.parse(savedEntries);
    return normalizeEntries(parsedEntries);
  } catch {
    return [];
  }
}

function saveLocalEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function setSyncMessage(message, isError = false) {
  syncStatus.textContent = message;
  syncStatus.style.color = isError ? 'var(--danger)' : 'var(--primary)';
}

function setSyncing(value) {
  isSyncing = value;
  form.querySelector('button').disabled = value;
  clearButton.disabled = value;
}

async function requestSpreadsheet(action, payload = {}) {
  return requestSpreadsheetJsonp(action, payload);
}

function requestSpreadsheetJsonp(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = `handleSpreadsheetResponse_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const script = document.createElement('script');
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('A planilha demorou para responder.'));
    }, 15000);

    const params = new URLSearchParams({
      action,
      callback: callbackName,
      payload: JSON.stringify(payload)
    });

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (data) => {
      cleanup();

      if (!data.ok) {
        reject(new Error(data.error || 'Nao foi possivel sincronizar com a planilha.'));
        return;
      }

      resolve(data);
    };

    script.addEventListener('error', () => {
      cleanup();
      reject(new Error('Nao foi possivel acessar a planilha.'));
    });

    script.src = `${SPREADSHEET_API_URL}?${params.toString()}`;
    document.body.appendChild(script);
  });
}

async function loadEntries() {
  entries = loadLocalEntries();

  if (!hasSpreadsheetApi()) {
    storageStatus.textContent = 'Seu progresso fica salvo neste navegador.';
    setSyncMessage('Configure a URL da planilha em SPREADSHEET_API_URL para usar como banco de dados.');
    render();
    return;
  }

  storageStatus.textContent = 'Usando a planilha como banco de dados.';
  setSyncing(true);
  setSyncMessage('Sincronizando com a planilha...');
  render();

  try {
    const data = await requestSpreadsheet('list');
    entries = normalizeEntries(data.entries);
    saveLocalEntries();
    setSyncMessage('Dados carregados da planilha.');
  } catch (error) {
    setSyncMessage(`${error.message} Usando os dados salvos neste navegador.`, true);
  } finally {
    setSyncing(false);
    render();
  }
}

async function persistEntry(entry) {
  if (!hasSpreadsheetApi()) {
    saveLocalEntries();
    return;
  }

  await requestSpreadsheet('add', { entry });
  saveLocalEntries();
  setSyncMessage('Lancamento salvo na planilha.');
}

async function removeEntry(entry) {
  if (!hasSpreadsheetApi()) {
    entries = entries.filter((currentEntry) => currentEntry.id !== entry.id);
    saveLocalEntries();
    render();
    return;
  }

  setSyncing(true);

  try {
    await requestSpreadsheet('delete', { id: entry.id });
    entries = entries.filter((currentEntry) => currentEntry.id !== entry.id);
    saveLocalEntries();
    setSyncMessage('Lancamento removido da planilha.');
  } catch (error) {
    setSyncMessage(error.message, true);
  } finally {
    setSyncing(false);
    render();
  }
}

async function clearEntries() {
  if (!hasSpreadsheetApi()) {
    entries = [];
    saveLocalEntries();
    render();
    return;
  }

  setSyncing(true);

  try {
    await requestSpreadsheet('clear');
    entries = [];
    saveLocalEntries();
    setSyncMessage('Planilha zerada.');
  } catch (error) {
    setSyncMessage(error.message, true);
  } finally {
    setSyncing(false);
    render();
  }
}

function formatHours(hours) {
  const totalMinutes = Math.round(hours * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes === 0) {
    return `${wholeHours}h`;
  }

  if (wholeHours === 0) {
    return `${minutes}m`;
  }

  return `${wholeHours}h ${minutes}m`;
}

function formatCurrency(value) {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function getTotalHours() {
  return entries.reduce((total, entry) => total + entry.hours, 0);
}

function parseHours(value) {
  const normalizedValue = value
    .trim()
    .toLowerCase()
    .replace(',', '.')
    .replace(/\s+/g, ' ');

  if (!normalizedValue) {
    return null;
  }

  const clockMatch = normalizedValue.match(/^(\d+):([0-5]?\d)$/);

  if (clockMatch) {
    return Number(clockMatch[1]) + Number(clockMatch[2]) / 60;
  }

  const hoursMatch = normalizedValue.match(/(\d+(?:\.\d+)?)\s*h/);
  const minutesMatch = normalizedValue.match(/(\d+)\s*m/);

  if (hoursMatch || minutesMatch) {
    const hours = hoursMatch ? Number(hoursMatch[1]) : 0;
    const minutes = minutesMatch ? Number(minutesMatch[1]) : 0;
    return hours + minutes / 60;
  }

  const decimalHours = Number(normalizedValue);
  return Number.isFinite(decimalHours) ? decimalHours : null;
}

function renderHistory() {
  historyList.innerHTML = '';

  if (entries.length === 0) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'empty-history';
    emptyItem.textContent = 'Nenhuma hora adicionada ainda.';
    historyList.appendChild(emptyItem);
    return;
  }

  entries.slice().reverse().forEach((entry, index) => {
    const item = document.createElement('li');
    const originalIndex = entries.length - 1 - index;
    const originalEntry = entries[originalIndex];
    const entryInfo = document.createElement('div');
    const date = document.createElement('span');
    const value = document.createElement('strong');
    const description = document.createElement('span');
    const removeButton = document.createElement('button');

    entryInfo.className = 'history-entry';
    date.textContent = entry.date;
    value.textContent = `${formatHours(entry.hours)} - ${formatCurrency(entry.hours * HOUR_VALUE)}`;
    description.className = 'history-description';
    description.textContent = entry.description || 'Sem descricao.';
    removeButton.className = 'remove-entry';
    removeButton.type = 'button';
    removeButton.textContent = 'Remover';

    removeButton.addEventListener('click', () => {
      removeEntry(originalEntry);
    });

    entryInfo.append(date, value, description);

    if (entry.jiraLink) {
      const jiraLink = document.createElement('a');
      jiraLink.className = 'history-link';
      jiraLink.href = entry.jiraLink;
      jiraLink.target = '_blank';
      jiraLink.rel = 'noopener noreferrer';
      jiraLink.textContent = 'Abrir task do Jira';
      entryInfo.appendChild(jiraLink);
    }

    item.append(entryInfo, removeButton);
    historyList.appendChild(item);
  });
}

function render() {
  const totalHours = getTotalHours();
  const totalEarned = totalHours * HOUR_VALUE;
  const missingHours = Math.max(GOAL_HOURS - totalHours, 0);
  const missingValue = missingHours * HOUR_VALUE;
  const percent = Math.min((totalHours / GOAL_HOURS) * 100, 100);

  workedHours.textContent = formatHours(totalHours);
  earnedValue.textContent = formatCurrency(totalEarned);
  remainingHours.textContent = formatHours(missingHours);
  remainingValue.textContent = formatCurrency(missingValue);
  progressPercent.textContent = `${Math.round(percent)}%`;
  progressFill.style.width = `${percent}%`;

  if (totalHours >= GOAL_HOURS) {
    statusMessage.textContent = 'Meta batida. Tudo que entrar agora e acima da meta.';
  } else if (totalHours > 0) {
    statusMessage.textContent = `Faltam ${formatHours(missingHours)} para fechar ${formatCurrency(GOAL_HOURS * HOUR_VALUE)}.`;
  } else {
    statusMessage.textContent = 'Voce ainda nao adicionou horas.';
  }

  renderHistory();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (isSyncing) {
    return;
  }

  const hours = parseHours(hoursInput.value);
  const description = descriptionInput.value.trim();
  const jiraLink = jiraInput.value.trim();

  if (!Number.isFinite(hours) || hours <= 0) {
    inputError.textContent = 'Digite um valor como 1h 35m, 1:35, 95m ou 1,5.';
    hoursInput.focus();
    return;
  }

  if (!description) {
    inputError.textContent = 'Digite uma descricao para o lancamento.';
    descriptionInput.focus();
    return;
  }

  inputError.textContent = '';

  const entry = {
    id: createEntryId(),
    hours,
    description,
    jiraLink,
    date: new Date().toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  };

  entries.push(entry);
  render();

  try {
    setSyncing(true);
    await persistEntry(entry);
    form.reset();
    hoursInput.focus();
  } catch (error) {
    entries = entries.filter((currentEntry) => currentEntry.id !== entry.id);
    setSyncMessage(error.message, true);
  } finally {
    setSyncing(false);
    render();
  }
});

clearButton.addEventListener('click', async () => {
  const shouldClear = confirm('Quer zerar todos os lancamentos?');

  if (!shouldClear) {
    return;
  }

  await clearEntries();
});

loadEntries();
