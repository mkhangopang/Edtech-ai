import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// --- Types ---

interface DocumentFile {
  id: string;
  name: string;
  type: 'pdf' | 'docx' | 'txt';
  content: string; // Extracted text
  size: number;
  uploadDate: number;
}

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  isError?: boolean;
  format?: OutputFormat;
}

type OutputFormat = 'auto' | 'report' | 'table' | 'concise' | 'step';

interface User {
  id: string;
  email: string;
  password: string; // In a real app, this would be hashed
  name: string;
  role: 'user' | 'admin';
  joinedDate: number;
}

interface RubricConfig {
  assignment: string;
  gradeLevel: string;
  scale: '3' | '4' | '5';
  bloomsLevel: string;
  objectives: string;
  useActiveDoc: boolean;
}

interface LessonConfig {
  templateId: string;
  topic: string;
  gradeLevel: string;
  duration: string;
  objectives: string;
  standards: string;
  useActiveDoc: boolean;
}

interface AssessmentConfig {
  type: 'mixed' | 'mcq' | 'srq' | 'erq';
  topic: string;
  gradeLevel: string;
  difficulty: 'easy' | 'medium' | 'hard';
  count: number;
  includeKey: boolean;
  useActiveDoc: boolean;
}

// Global window extensions for CDN libraries
declare global {
  interface Window {
    pdfjsLib: any;
    mammoth: any;
    marked: any;
    jspdf: any;
  }
}

// --- Constants ---

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// CORE MASTER PROMPT: This is the fallback "DNA" of the app. 
// Even if local storage is wiped, this remains the default.
const DEFAULT_MASTER_PROMPT = `
ROLE: You are "Edtech AI", an elite pedagogical consultant and educational content specialist. 

CORE DIRECTIVES:
1. EDUCATIONAL EXPERTISE: Always apply best practices from Bloom's Taxonomy, the 5E Instructional Model, and Understanding by Design (UbD).
2. CONTEXT AWARENESS: When a document is provided, strictly ground your answers in that source material unless explicitly asked for outside knowledge.
3. FORMATTING: Use professional, structured formatting. Use bolding for key terms, lists for steps, and clear headings.
4. TONE: Professional, encouraging, and academically rigorous yet accessible.
5. SAFETY: Do not generate content that promotes academic dishonesty (like writing full essays for students to submit as their own) or unsafe classroom practices.

SPECIFIC OUTPUT RULES:
- If generating a Rubric: Use a table format.
- If generating a Quiz: Include an answer key at the bottom.
- If summarizing: Use the "Bottom Line Up Front" (BLUF) method.
`.trim();

// Versioned keys to prevent stale data conflicts
const STORAGE_KEYS = {
  USERS: 'edtech_users_v3', 
  SESSION: 'edtech_session_v3',
  PROMPT: 'edtech_prompt_v3',
  STATS: 'edtech_stats_v3'
};

const BLOOMS_LEVELS = [
  { id: 'Remembering', label: 'Remembering (Recall facts)' },
  { id: 'Understanding', label: 'Understanding (Explain ideas)' },
  { id: 'Applying', label: 'Applying (Use information)' },
  { id: 'Analyzing', label: 'Analyzing (Draw connections)' },
  { id: 'Evaluating', label: 'Evaluating (Justify a stand)' },
  { id: 'Creating', label: 'Creating (Produce original work)' },
  { id: 'Mixed', label: 'Mixed / Varied Levels' }
];

const LESSON_TEMPLATES = [
  { 
    id: '5e', 
    name: '5E Instructional Model', 
    description: 'Inquiry-based: Engage, Explore, Explain, Elaborate, Evaluate.',
    sections: ['Engage', 'Explore', 'Explain', 'Elaborate', 'Evaluate'] 
  },
  { 
    id: 'direct', 
    name: 'Direct Instruction', 
    description: 'Classic structure: Objectives, Modeling, Guided & Independent Practice.',
    sections: ['Anticipatory Set', 'Direct Instruction', 'Guided Practice', 'Independent Practice', 'Closure'] 
  },
  { 
    id: 'ubd', 
    name: 'Understanding by Design (UbD)', 
    description: 'Backward design focusing on desired results and evidence.',
    sections: ['Desired Results', 'Assessment Evidence', 'Learning Plan'] 
  }
];

// --- Icons (SVG) ---

const IconMenu = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const IconClose = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
);

const IconUpload = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
  </svg>
);

const IconFile = ({ type }: { type: string }) => {
  let colorClass = "text-gray-400";
  if (type === 'pdf') colorClass = "text-red-400";
  if (type === 'docx') colorClass = "text-blue-400";
  
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 ${colorClass}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 011.414.586l5.414 5.414a1 1 0 01.586 1.414V19a2 2 0 01-2 2z" />
    </svg>
  );
};

const IconTrash = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const IconSettings = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
  </svg>
);

const IconCpu = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
  </svg>
);

const IconLock = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
  </svg>
);

const IconUnlock = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
    <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
  </svg>
);

const IconSend = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
  </svg>
);

const IconMoon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
    <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
  </svg>
);

const IconSun = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
  </svg>
);

const IconBot = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

const IconDownload = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
  </svg>
);

const IconCopy = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const IconFormat = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
  </svg>
);

const IconLogout = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
  </svg>
);

const IconUser = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
  </svg>
);

const IconShield = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
  </svg>
);

const IconTable = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7-4h14M4 6h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" />
  </svg>
);

const IconClipboard = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
  </svg>
);

const IconClipboardCheck = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
  </svg>
);

const IconSparkles = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
  </svg>
);

const IconCheck = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
);

const IconXCircle = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
    </svg>
);

// --- Helpers ---

const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const extractTextFromPDF = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(" ");
    fullText += pageText + "\n\n";
  }
  return fullText;
};

const extractTextFromDOCX = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer: arrayBuffer });
  return result.value;
};

// Safe API Key retrieval (handles both node process and browser environments if bundled)
const getApiKey = (): string | undefined => {
    try {
        return process.env.API_KEY || (import.meta as any).env?.VITE_API_KEY;
    } catch (e) {
        return undefined;
    }
};

// --- Auth Helpers ---

const getStoredUsers = (): User[] => {
  try {
    const usersStr = localStorage.getItem(STORAGE_KEYS.USERS);
    return usersStr ? JSON.parse(usersStr) : [];
  } catch (e) {
    return [];
  }
};

const saveUser = (user: User) => {
  const users = getStoredUsers();
  // Check for duplicates
  const exists = users.findIndex(u => u.id === user.id || u.email.toLowerCase() === user.email.toLowerCase());
  if (exists === -1) {
      users.push(user);
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
  }
};

const getSession = (): User | null => {
  try {
      const sessionStr = localStorage.getItem(STORAGE_KEYS.SESSION);
      return sessionStr ? JSON.parse(sessionStr) : null;
  } catch (e) {
      return null;
  }
};

const setSession = (user: User) => {
  localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(user));
};

const clearSession = () => {
  localStorage.removeItem(STORAGE_KEYS.SESSION);
};

// --- Stats Helpers ---

const getSystemStats = () => {
  const statsStr = localStorage.getItem(STORAGE_KEYS.STATS);
  // Default to some simulated data so the dashboard isn't empty on first run
  return statsStr ? JSON.parse(statsStr) : { docs: 42, queries: 128 };
};

const incrementStat = (key: 'docs' | 'queries') => {
  const stats = getSystemStats();
  stats[key]++;
  localStorage.setItem(STORAGE_KEYS.STATS, JSON.stringify(stats));
};

// --- Format Options ---

const FORMAT_OPTIONS: { id: OutputFormat; label: string; instruction: string }[] = [
  { id: 'auto', label: 'Auto Format', instruction: "Answer naturally based on the query." },
  { id: 'report', label: 'Pro Report', instruction: "Format the response as a professional report. Use H1 for the main title, H2 for sections, bullet points for lists, and **bold** for key insights. Ensure the tone is formal and structured." },
  { id: 'table', label: 'Data Table', instruction: "Present the answer primarily as a Markdown table. If there is data to compare or list, use columns and rows. Ensure headers are clear." },
  { id: 'concise', label: 'Concise Summary', instruction: "Provide a very brief, high-level summary. Use bullet points. Keep it under 200 words if possible. Focus on the 'Bottom Line Up Front' (BLUF)." },
  { id: 'step', label: 'Step-by-Step', instruction: "Break the answer down into a numbered step-by-step guide. Use bold numbering (e.g., **Step 1:**) and clear instructions." }
];

// --- Components ---

const MarkdownContent = ({ content }: { content: string }) => {
  const [html, setHtml] = useState('');

  useEffect(() => {
    if (window.marked) {
      setHtml(window.marked.parse(content));
    } else {
      setHtml(content);
    }
  }, [content]);

  return (
    <div 
      className="prose dark:prose-invert max-w-none text-sm leading-relaxed break-words"
      dangerouslySetInnerHTML={{ __html: html }} 
    />
  );
};

// --- Auth Component ---

const AuthScreen = ({ onLogin }: { onLogin: (user: User) => void }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [error, setError] = useState('');

  // Auto-seed Default Admin on mount if no users exist
  useEffect(() => {
     const users = getStoredUsers();
     const adminExists = users.some(u => u.email === 'admin@edtech.ai');
     
     if (!adminExists) {
        const defaultAdmin: User = {
           id: 'default-admin-id',
           email: 'admin@edtech.ai',
           password: 'admin',
           name: 'System Admin',
           role: 'admin',
           joinedDate: Date.now()
        };
        saveUser(defaultAdmin);
     }
  }, []);

  const handleResetData = () => {
      if (confirm("FACTORY RESET WARNING:\n\nThis will delete ALL local accounts, documents, and settings. You will need to sign in again. Use this only if the app is stuck.\n\nContinue?")) {
          localStorage.clear();
          window.location.reload();
      }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPass = password.trim();

    if (isLogin) {
      const users = getStoredUsers();
      // Case-insensitive email comparison and trimmed password
      const user = users.find(u => u.email.toLowerCase() === cleanEmail && u.password === cleanPass);
      
      if (user) {
        setSession(user);
        onLogin(user);
      } else {
        setError('Invalid credentials. (Check capitalization or try admin@edtech.ai / admin)');
      }
    } else {
      const users = getStoredUsers();
      if (users.find(u => u.email.toLowerCase() === cleanEmail)) {
        setError('User already exists');
        return;
      }
      if (!name) {
        setError('Name is required');
        return;
      }
      
      const newUser: User = {
        id: crypto.randomUUID(),
        email: cleanEmail,
        password: cleanPass,
        name: name.trim(),
        role,
        joinedDate: Date.now()
      };
      
      // Save user first, then set session
      saveUser(newUser);
      setSession(newUser);
      
      // Small delay to ensure storage write before login state triggers render
      setTimeout(() => {
          onLogin(newUser);
      }, 50);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 font-sans relative">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl flex overflow-hidden border border-gray-200 dark:border-gray-700 min-h-[600px]">
        {/* Left Side - Brand */}
        <div className="w-1/2 bg-gradient-to-br from-primary-600 to-indigo-800 p-12 hidden md:flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
          <div className="relative z-10">
            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center mb-6 shadow-lg">
              <span className="text-2xl font-bold text-primary-600">E</span>
            </div>
            <h1 className="text-4xl font-bold text-white mb-4 leading-tight">
              Unlock the power of your educational content.
            </h1>
            <p className="text-primary-100 text-lg">
              Edtech AI transforms static files into interactive knowledge bases. Chat, analyze, and extract insights in seconds.
            </p>
          </div>
          <div className="relative z-10">
            <div className="flex -space-x-2 mb-4">
              <div className="w-10 h-10 rounded-full border-2 border-primary-500 bg-gray-200"></div>
              <div className="w-10 h-10 rounded-full border-2 border-primary-500 bg-gray-300"></div>
              <div className="w-10 h-10 rounded-full border-2 border-primary-500 bg-gray-400"></div>
              <div className="w-10 h-10 rounded-full border-2 border-primary-500 bg-primary-100 flex items-center justify-center text-xs font-bold text-primary-700">+2k</div>
            </div>
            <p className="text-sm text-primary-200">Join thousands of educators saving time today.</p>
          </div>
        </div>

        {/* Right Side - Form */}
        <div className="w-full md:w-1/2 p-8 md:p-12 flex flex-col justify-center bg-white dark:bg-gray-800 relative">
          <div className="max-w-md mx-auto w-full">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              {isLogin ? 'Welcome Back' : 'Create Account'}
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-8">
              {isLogin ? 'Enter your details to access your workspace.' : 'Get started with Edtech AI for free.'}
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              {!isLogin && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full Name</label>
                  <input 
                    type="text" 
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all dark:text-white"
                    placeholder="John Doe"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email Address</label>
                <input 
                  type="email" 
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all dark:text-white"
                  placeholder="name@company.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
                <input 
                  type="password" 
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all dark:text-white"
                  placeholder="••••••••"
                />
              </div>

              {!isLogin && (
                <div>
                   <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Role</label>
                   <select 
                      value={role}
                      onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
                      className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all dark:text-white"
                   >
                     <option value="user">User</option>
                     <option value="admin">Admin</option>
                   </select>
                </div>
              )}

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <button 
                type="submit" 
                className="w-full bg-primary-600 hover:bg-primary-700 text-white font-semibold py-3 rounded-lg transition-all shadow-lg hover:shadow-primary-500/30"
              >
                {isLogin ? 'Sign In' : 'Sign Up'}
              </button>
            </form>

            <div className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
              {isLogin ? "Don't have an account? " : "Already have an account? "}
              <button 
                onClick={() => { setIsLogin(!isLogin); setError(''); }}
                className="text-primary-600 hover:text-primary-500 font-medium hover:underline"
              >
                {isLogin ? 'Sign up' : 'Log in'}
              </button>
            </div>
            
            {/* Quick Helper for Admin Access */}
            <div className="mt-4 text-center">
                <span className="text-[10px] text-gray-400 cursor-help" title="Default credentials for testing">
                    Need help? Try admin@edtech.ai / admin
                </span>
            </div>
            
            {/* Factory Reset Danger Zone */}
            <div className="absolute bottom-4 right-4">
                 <button onClick={handleResetData} className="text-[10px] text-gray-300 hover:text-red-400 transition-colors flex items-center gap-1">
                    <IconTrash /> Reset App Data
                 </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ... [Rubric, Assessment, and Lesson Plan Modal components are unchanged] ...

// --- Rubric Generator Component ---
const RubricGeneratorModal = ({ 
  isOpen, 
  onClose, 
  onGenerate,
  activeDocName
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  onGenerate: (config: RubricConfig) => void,
  activeDocName: string | null
}) => {
  const [config, setConfig] = useState<RubricConfig>({
    assignment: '',
    gradeLevel: '9th Grade',
    scale: '4',
    bloomsLevel: 'Applying',
    objectives: '',
    useActiveDoc: !!activeDocName
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-200 dark:border-gray-700 flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <div className="flex justify-between items-center">
             <div className="flex items-center gap-3">
               <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400">
                 <IconTable />
               </div>
               <div>
                 <h2 className="text-lg font-bold text-gray-900 dark:text-white">Rubric Generator</h2>
                 <p className="text-xs text-gray-500 dark:text-gray-400">Create detailed grading rubrics instantly</p>
               </div>
             </div>
             <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
               <IconClose />
             </button>
          </div>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Assignment Title / Description</label>
            <textarea 
              value={config.assignment}
              onChange={(e) => setConfig({...config, assignment: e.target.value})}
              placeholder="e.g. Persuasive Essay on Climate Change"
              className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white text-sm"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div>
               <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Grade Level</label>
               <select 
                 value={config.gradeLevel}
                 onChange={(e) => setConfig({...config, gradeLevel: e.target.value})}
                 className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white text-sm"
               >
                 <option>Elementary (K-5)</option>
                 <option>Middle School (6-8)</option>
                 <option>9th Grade</option>
                 <option>10th Grade</option>
                 <option>11th Grade</option>
                 <option>12th Grade</option>
                 <option>Undergraduate</option>
                 <option>Graduate</option>
               </select>
             </div>
             <div>
               <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Point Scale</label>
               <select 
                 value={config.scale}
                 onChange={(e) => setConfig({...config, scale: e.target.value as any})}
                 className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white text-sm"
               >
                 <option value="3">3-Point (Low/Mid/High)</option>
                 <option value="4">4-Point (Standard)</option>
                 <option value="5">5-Point (Detailed)</option>
               </select>
             </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Target Bloom's Level</label>
            <select 
              value={config.bloomsLevel}
              onChange={(e) => setConfig({...config, bloomsLevel: e.target.value})}
              className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white text-sm"
            >
              {BLOOMS_LEVELS.map(level => (
                <option key={level.id} value={level.id}>{level.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Learning Objectives / Criteria (Optional)</label>
            <textarea 
              value={config.objectives}
              onChange={(e) => setConfig({...config, objectives: e.target.value})}
              placeholder="e.g. Grammar, Thesis Statement, Evidence usage..."
              className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white text-sm"
              rows={2}
            />
          </div>
          
          {activeDocName && (
            <div className="flex items-center gap-2 pt-2">
               <input 
                 type="checkbox" 
                 id="useActiveDoc"
                 checked={config.useActiveDoc}
                 onChange={(e) => setConfig({...config, useActiveDoc: e.target.checked})}
                 className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500 border-gray-300"
               />
               <label htmlFor="useActiveDoc" className="text-sm text-gray-700 dark:text-gray-300">
                 Base on active document: <span className="font-medium text-primary-600">{activeDocName}</span>
               </label>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex justify-end gap-3">
           <button 
             onClick={onClose}
             className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
           >
             Cancel
           </button>
           <button 
             onClick={() => onGenerate(config)}
             disabled={!config.assignment}
             className="px-5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg shadow-lg shadow-primary-500/30 transition-all flex items-center gap-2"
           >
             <IconSparkles />
             Generate Rubric
           </button>
        </div>
      </div>
    </div>
  );
};

// --- Assessment Generator Component ---
const AssessmentGeneratorModal = ({ 
  isOpen, 
  onClose, 
  onGenerate,
  activeDocName
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  onGenerate: (config: AssessmentConfig) => void,
  activeDocName: string | null
}) => {
  const [config, setConfig] = useState<AssessmentConfig>({
    type: 'mixed',
    topic: '',
    gradeLevel: '9th Grade',
    difficulty: 'medium',
    count: 10,
    includeKey: true,
    useActiveDoc: !!activeDocName
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-200 dark:border-gray-700 flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <div className="flex justify-between items-center">
             <div className="flex items-center gap-3">
               <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400">
                 <IconClipboardCheck />
               </div>
               <div>
                 <h2 className="text-lg font-bold text-gray-900 dark:text-white">Assessment Generator</h2>
                 <p className="text-xs text-gray-500 dark:text-gray-400">Generate MCQs, SRQs, and ERQs</p>
               </div>
             </div>
             <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
               <IconClose />
             </button>
          </div>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Question Type</label>
            <div className="grid grid-cols-2 gap-2">
                {[
                    { id: 'mixed', label: 'Mixed Assessment' },
                    { id: 'mcq', label: 'Multiple Choice (MCQ)' },
                    { id: 'srq', label: 'Short Response (SRQ)' },
                    { id: 'erq', label: 'Extended Response (ERQ)' }
                ].map(type => (
                    <button
                        key={type.id}
                        onClick={() => setConfig({...config, type: type.id as any})}
                        className={`py-2 px-3 text-sm rounded-lg border transition-all ${
                            config.type === type.id 
                            ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500 text-primary-700 dark:text-primary-300 font-medium' 
                            : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                        }`}
                    >
                        {type.label}
                    </button>
                ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Topic / Subject</label>
            <input 
              type="text"
              value={config.topic}
              onChange={(e) => setConfig({...config, topic: e.target.value})}
              placeholder="e.g. World War II, Calculus, Shakespeare"
              className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div>
               <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Grade Level</label>
               <input 
                 type="text"
                 value={config.gradeLevel}
                 onChange={(e) => setConfig({...config, gradeLevel: e.target.value})}
                 className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white text-sm"
               />
             </div>
             <div>
               <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Total Questions</label>
               <input 
                 type="number"
                 min="1"
                 max="50"
                 value={config.count}
                 onChange={(e) => setConfig({...config, count: parseInt(e.target.value) || 10})}
                 className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white text-sm"
               />
             </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Difficulty</label>
            <select 
              value={config.difficulty}
              onChange={(e) => setConfig({...config, difficulty: e.target.value as any})}
              className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white text-sm"
            >
              <option value="easy">Easy (Recall/Basic Understanding)</option>
              <option value="medium">Medium (Application/Analysis)</option>
              <option value="hard">Hard (Evaluation/Synthesis)</option>
            </select>
          </div>

          <div className="flex items-center gap-2 pt-2">
               <input 
                 type="checkbox" 
                 id="includeKey"
                 checked={config.includeKey}
                 onChange={(e) => setConfig({...config, includeKey: e.target.checked})}
                 className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500 border-gray-300"
               />
               <label htmlFor="includeKey" className="text-sm text-gray-700 dark:text-gray-300">
                 Include Answer Key & Explanations
               </label>
          </div>
          
          {activeDocName && (
            <div className="flex items-center gap-2">
               <input 
                 type="checkbox" 
                 id="useActiveDocAssess"
                 checked={config.useActiveDoc}
                 onChange={(e) => setConfig({...config, useActiveDoc: e.target.checked})}
                 className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500 border-gray-300"
               />
               <label htmlFor="useActiveDocAssess" className="text-sm text-gray-700 dark:text-gray-300">
                 Base on active document: <span className="font-medium text-primary-600">{activeDocName}</span>
               </label>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex justify-end gap-3">
           <button 
             onClick={onClose}
             className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
           >
             Cancel
           </button>
           <button 
             onClick={() => onGenerate(config)}
             disabled={!config.topic && !config.useActiveDoc}
             className="px-5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg shadow-lg shadow-primary-500/30 transition-all flex items-center gap-2"
           >
             <IconSparkles />
             Generate Quiz
           </button>
        </div>
      </div>
    </div>
  );
};

// --- Lesson Plan Modal Component ---
const LessonPlanModal = ({ 
  isOpen, 
  onClose, 
  onGenerate,
  activeDocName
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  onGenerate: (config: LessonConfig) => void,
  activeDocName: string | null
}) => {
  const [config, setConfig] = useState<LessonConfig>({
    templateId: '5e',
    topic: '',
    gradeLevel: '9th Grade',
    duration: '60 minutes',
    objectives: '',
    standards: '',
    useActiveDoc: !!activeDocName
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-200 dark:border-gray-700 flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <div className="flex justify-between items-center">
             <div className="flex items-center gap-3">
               <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400">
                 <IconClipboard />
               </div>
               <div>
                 <h2 className="text-lg font-bold text-gray-900 dark:text-white">Lesson Plan Generator</h2>
                 <p className="text-xs text-gray-500 dark:text-gray-400">Design lessons using proven frameworks</p>
               </div>
             </div>
             <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
               <IconClose />
             </button>
          </div>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Template Selection */}
          <div>
             <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Lesson Framework</label>
             <div className="grid grid-cols-1 gap-2">
                {LESSON_TEMPLATES.map(template => (
                   <div 
                      key={template.id}
                      onClick={() => setConfig({...config, templateId: template.id})}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        config.templateId === template.id
                        ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500 ring-1 ring-primary-500'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-400'
                      }`}
                   >
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">{template.name}</span>
                        {config.templateId === template.id && (
                           <span className="text-primary-600 dark:text-primary-400"><IconSparkles /></span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{template.description}</p>
                   </div>
                ))}
             </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Topic / Subject</label>
            <input 
              type="text"
              value={config.topic}
              onChange={(e) => setConfig({...config, topic: e.target.value})}
              placeholder="e.g. Photosynthesis, The Civil War, Linear Equations"
              className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div>
               <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Grade Level</label>
               <input 
                 type="text"
                 value={config.gradeLevel}
                 onChange={(e) => setConfig({...config, gradeLevel: e.target.value})}
                 placeholder="e.g. 5th Grade"
                 className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white text-sm"
               />
             </div>
             <div>
               <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Duration</label>
               <input 
                 type="text"
                 value={config.duration}
                 onChange={(e) => setConfig({...config, duration: e.target.value})}
                 placeholder="e.g. 60 min"
                 className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white text-sm"
               />
             </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Learning Objectives</label>
            <textarea 
              value={config.objectives}
              onChange={(e) => setConfig({...config, objectives: e.target.value})}
              placeholder="e.g. Students will be able to identify key battles..."
              className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white text-sm"
              rows={2}
            />
          </div>

          <div>
             <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Standards (Optional)</label>
             <input 
               type="text"
               value={config.standards}
               onChange={(e) => setConfig({...config, standards: e.target.value})}
               placeholder="e.g. CCSS.ELA-LITERACY.RL.9-10.1"
               className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white text-sm"
             />
          </div>
          
          {activeDocName && (
            <div className="flex items-center gap-2 pt-2">
               <input 
                 type="checkbox" 
                 id="useActiveDocLesson"
                 checked={config.useActiveDoc}
                 onChange={(e) => setConfig({...config, useActiveDoc: e.target.checked})}
                 className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500 border-gray-300"
               />
               <label htmlFor="useActiveDocLesson" className="text-sm text-gray-700 dark:text-gray-300">
                 Base on content from: <span className="font-medium text-primary-600">{activeDocName}</span>
               </label>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex justify-end gap-3">
           <button 
             onClick={onClose}
             className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
           >
             Cancel
           </button>
           <button 
             onClick={() => onGenerate(config)}
             disabled={!config.topic}
             className="px-5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg shadow-lg shadow-primary-500/30 transition-all flex items-center gap-2"
           >
             <IconSparkles />
             Generate Lesson
           </button>
        </div>
      </div>
    </div>
  );
};

// --- Admin Dashboard Component ---

const AdminDashboard = ({ isOpen, onClose, currentUser }: { isOpen: boolean, onClose: () => void, currentUser: User }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState({ docs: 0, queries: 0 });
  const [hasApiKey, setHasApiKey] = useState(false);
  
  useEffect(() => {
    if (isOpen) {
      setUsers(getStoredUsers());
      setStats(getSystemStats());
      setHasApiKey(!!getApiKey());
    }
  }, [isOpen]);

  const handleDeleteUser = (id: string) => {
    if (id === currentUser.id) {
        alert("You cannot delete yourself.");
        return;
    }
    if (confirm("Are you sure you want to delete this user?")) {
      const updatedUsers = users.filter(u => u.id !== id);
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(updatedUsers));
      setUsers(updatedUsers);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 w-full max-w-6xl h-[80vh] rounded-2xl shadow-2xl flex flex-col border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400">
                <IconShield />
             </div>
             <div>
               <h2 className="text-xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h2>
               <p className="text-sm text-gray-500 dark:text-gray-400">System Overview & User Management</p>
             </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-gray-500">
            <IconClose />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8">
           {/* Stats */}
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                 <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Users</h3>
                 <div className="mt-3 flex items-baseline">
                   <div className="text-3xl font-bold text-gray-900 dark:text-white">{users.length}</div>
                 </div>
                 <div className="mt-2 text-xs text-green-500 font-medium">+12% from last month</div>
              </div>
              <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                 <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">System Status</h3>
                 <div className="mt-3 flex items-center gap-2">
                   {hasApiKey ? (
                       <>
                         <IconCheck />
                         <span className="text-lg font-bold text-green-600">Online</span>
                       </>
                   ) : (
                       <>
                         <IconXCircle />
                         <span className="text-lg font-bold text-red-500">API Key Missing</span>
                       </>
                   )}
                 </div>
                 <div className="mt-2 text-xs text-gray-400">{hasApiKey ? 'Ready for queries' : 'Check environment'}</div>
              </div>
              <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                 <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Documents</h3>
                 <div className="mt-3 flex items-baseline">
                   <div className="text-3xl font-bold text-gray-900 dark:text-white">{stats.docs}</div>
                 </div>
                 <div className="mt-2 text-xs text-indigo-500 font-medium">Uploaded to system</div>
              </div>
              <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                 <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total AI Queries</h3>
                 <div className="mt-3 flex items-baseline">
                   <div className="text-3xl font-bold text-gray-900 dark:text-white">{stats.queries}</div>
                 </div>
                 <div className="mt-2 text-xs text-purple-500 font-medium">Lifetime generations</div>
              </div>
           </div>

           {/* User Table */}
           <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white">Registered Users</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 uppercase font-medium">
                    <tr>
                      <th className="px-6 py-3">Name</th>
                      <th className="px-6 py-3">Email</th>
                      <th className="px-6 py-3">Role</th>
                      <th className="px-6 py-3">Joined</th>
                      <th className="px-6 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {users.map(user => (
                      <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                        <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-xs uppercase">
                                    {user.name.charAt(0)}
                                </div>
                                {user.name}
                            </div>
                        </td>
                        <td className="px-6 py-4 text-gray-600 dark:text-gray-300">{user.email}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            user.role === 'admin' 
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' 
                            : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                          }`}>
                            {user.role}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                           {new Date(user.joinedDate).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 text-right">
                           <button 
                             onClick={() => handleDeleteUser(user.id)}
                             disabled={user.id === currentUser.id}
                             className="text-red-500 hover:text-red-700 disabled:opacity-30 disabled:cursor-not-allowed font-medium transition-colors"
                           >
                             Delete
                           </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

// --- Main App Component ---

const App = () => {
  // Auth State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  // App State
  const [documents, setDocuments] = useState<DocumentFile[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [masterPrompt, setMasterPrompt] = useState<string>(() => {
    // Attempt to read from storage
    const stored = localStorage.getItem(STORAGE_KEYS.PROMPT);
    // Safety check: if stored is empty string (accidental clear), fallback to default
    if (stored && stored.trim().length > 0) {
        return stored;
    }
    return DEFAULT_MASTER_PROMPT;
  });
  // Neural Core Lock State
  const [isCoreUnlocked, setIsCoreUnlocked] = useState(false);
  
  const [showSettings, setShowSettings] = useState(false);
  const [showRubricModal, setShowRubricModal] = useState(false);
  const [showLessonModal, setShowLessonModal] = useState(false);
  const [showAssessmentModal, setShowAssessmentModal] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const [selectedFormat, setSelectedFormat] = useState<OutputFormat>('auto');
  
  // UI State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // --- Effects ---
  
  useEffect(() => {
    // Check for existing session on mount
    const session = getSession();
    if (session) {
      setCurrentUser(session);
    }
  }, []);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  // --- Handlers ---

  const handleLogin = (user: User) => {
    setCurrentUser(user);
  };

  const handleLogout = () => {
    clearSession();
    setCurrentUser(null);
    setDocuments([]);
    setActiveDocId(null);
    setMessages([]);
    setShowSettings(false); // Ensure settings panel is closed
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    setFileError(null);
    setIsProcessingFile(true);

    const file = files[0];
    
    if (file.size > MAX_FILE_SIZE) {
      setFileError(`File too large. Maximum size is ${formatBytes(MAX_FILE_SIZE)}`);
      setIsProcessingFile(false);
      return;
    }

    try {
      const fileType = file.name.split('.').pop()?.toLowerCase();
      let content = "";
      let type: DocumentFile['type'] = 'txt';

      if (fileType === 'pdf') {
        type = 'pdf';
        content = await extractTextFromPDF(file);
      } else if (fileType === 'docx') {
        type = 'docx';
        content = await extractTextFromDOCX(file);
      } else if (fileType === 'txt') {
        type = 'txt';
        content = await file.text();
      } else {
        throw new Error("Unsupported file format");
      }

      const newDoc: DocumentFile = {
        id: crypto.randomUUID(),
        name: file.name,
        type,
        content,
        size: file.size,
        uploadDate: Date.now()
      };

      setDocuments(prev => [...prev, newDoc]);
      setActiveDocId(newDoc.id);
      setShowWelcome(false);
      incrementStat('docs');
    } catch (err) {
      console.error(err);
      setFileError("Failed to process file. Please try again.");
    } finally {
      setIsProcessingFile(false);
      // Reset input
      event.target.value = '';
    }
  };

  const handleDeleteDoc = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDocuments(prev => prev.filter(d => d.id !== id));
    if (activeDocId === id) {
      setActiveDocId(null);
    }
  };

  const saveMasterPrompt = () => {
    localStorage.setItem(STORAGE_KEYS.PROMPT, masterPrompt);
    setIsCoreUnlocked(false);
    // Keep panel open but locked to show confirmation, or could close it.
    // Let's keep it open so they see the lock state change.
  };

  const handleGenerateRubric = async (config: RubricConfig) => {
    setShowRubricModal(false);
    setIsSidebarOpen(false); // Close mobile sidebar if open
    
    const apiKey = getApiKey();
    if (!apiKey) {
      setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'model',
          text: "⚠️ **System Error**: API Key is missing or invalid in the environment configuration. Please check your deployment settings.",
          timestamp: Date.now(),
          isError: true
      }]);
      return;
    }

    const activeDoc = documents.find(d => d.id === activeDocId);
    
    const userText = `Generate a ${config.scale}-point rubric for "${config.assignment}" (${config.gradeLevel}) focusing on ${config.bloomsLevel}.`;
    const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        text: userText,
        timestamp: Date.now()
    };
    
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setShowWelcome(false);
    incrementStat('queries');

    try {
       const ai = new GoogleGenAI({ apiKey });
       
       let contentParts = [];
       // Add Context if selected
       if (config.useActiveDoc && activeDoc) {
          contentParts.push(`CONTEXT (Active Document - ${activeDoc.name}):\n${activeDoc.content.substring(0, 30000)}\n\n`);
       }

       const systemPrompt = `
Task: Create a detailed grading rubric.
Assignment: ${config.assignment}
Grade Level: ${config.gradeLevel}
Scale: ${config.scale}-Point Scale
Target Cognitive Level (Bloom's Taxonomy): ${config.bloomsLevel}
Specific Objectives/Criteria: ${config.objectives || 'Standard academic criteria for this task.'}

Output Format Requirements:
1. Provide a title for the rubric (H2).
2. Create a Markdown Table.
3. Columns must be the performance levels (e.g. 1 to ${config.scale}).
4. Rows must be the assessment criteria.
5. Cells must contain detailed descriptors of performance for that level.
6. Use clear, professional educational language.
7. Ensure the criteria descriptors reflect the selected Bloom's Taxonomy level (${config.bloomsLevel}) where appropriate.
       `;
       
       contentParts.push(systemPrompt);

       const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contentParts.join(''),
        config: {
          systemInstruction: masterPrompt,
        }
      });

      const text = response.text;

      const aiMsg: Message = {
        id: crypto.randomUUID(),
        role: 'model',
        text: text,
        timestamp: Date.now(),
        format: 'table'
      };

      setMessages(prev => [...prev, aiMsg]);

    } catch (err) {
        console.error(err);
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'model',
          text: "Error generating rubric. Please check your connection and API key.",
          timestamp: Date.now(),
          isError: true
        }]);
    } finally {
        setIsLoading(false);
    }
  };

  const handleGenerateLessonPlan = async (config: LessonConfig) => {
    setShowLessonModal(false);
    setIsSidebarOpen(false); // Close mobile sidebar if open
    
    const apiKey = getApiKey();
    if (!apiKey) {
      setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'model',
          text: "⚠️ **System Error**: API Key is missing or invalid in the environment configuration. Please check your deployment settings.",
          timestamp: Date.now(),
          isError: true
      }]);
      return;
    }

    const activeDoc = documents.find(d => d.id === activeDocId);
    const selectedTemplate = LESSON_TEMPLATES.find(t => t.id === config.templateId);
    
    const userText = `Generate a ${selectedTemplate?.name} lesson plan for "${config.topic}" (${config.gradeLevel}).`;
    const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        text: userText,
        timestamp: Date.now()
    };
    
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setShowWelcome(false);
    incrementStat('queries');

    try {
       const ai = new GoogleGenAI({ apiKey });
       
       let contentParts = [];
       // Add Context if selected
       if (config.useActiveDoc && activeDoc) {
          contentParts.push(`CONTEXT (Active Document - ${activeDoc.name}):\n${activeDoc.content.substring(0, 30000)}\n\n`);
       }

       const systemPrompt = `
Task: Create a detailed lesson plan.
Framework: ${selectedTemplate?.name}
Topic: ${config.topic}
Grade Level: ${config.gradeLevel}
Duration: ${config.duration}
Objectives: ${config.objectives || 'Appropriate for grade level'}
Standards: ${config.standards || 'Relevant state/national standards'}

Output Format Requirements:
1. Title (H1): Lesson Topic
2. Header Info: Grade, Time, Standards.
3. Structure the lesson strictly using the ${selectedTemplate?.name} phases: ${selectedTemplate?.sections.join(', ')}.
4. Use H2 for each phase/section.
5. Provide specific activities, teacher moves, and student actions for each phase.
6. Include a Materials list.
7. Use professional educational tone.
       `;
       
       contentParts.push(systemPrompt);

       const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contentParts.join(''),
        config: {
          systemInstruction: masterPrompt,
        }
      });

      const text = response.text;

      const aiMsg: Message = {
        id: crypto.randomUUID(),
        role: 'model',
        text: text,
        timestamp: Date.now(),
        format: 'report'
      };

      setMessages(prev => [...prev, aiMsg]);

    } catch (err) {
        console.error(err);
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'model',
          text: "Error generating lesson plan. Please check your connection and API key.",
          timestamp: Date.now(),
          isError: true
        }]);
    } finally {
        setIsLoading(false);
    }
  };

  const handleGenerateAssessment = async (config: AssessmentConfig) => {
    setShowAssessmentModal(false);
    setIsSidebarOpen(false); // Close mobile sidebar if open
    
    const apiKey = getApiKey();
    if (!apiKey) {
      setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'model',
          text: "⚠️ **System Error**: API Key is missing or invalid in the environment configuration. Please check your deployment settings.",
          timestamp: Date.now(),
          isError: true
      }]);
      return;
    }

    const activeDoc = documents.find(d => d.id === activeDocId);
    
    const userText = `Generate a ${config.count} question ${config.type.toUpperCase()} assessment for "${config.topic}" (${config.gradeLevel}).`;
    const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        text: userText,
        timestamp: Date.now()
    };
    
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setShowWelcome(false);
    incrementStat('queries');

    try {
       const ai = new GoogleGenAI({ apiKey });
       
       let contentParts = [];
       // Add Context if selected
       if (config.useActiveDoc && activeDoc) {
          contentParts.push(`CONTEXT (Active Document - ${activeDoc.name}):\n${activeDoc.content.substring(0, 30000)}\n\n`);
       }

       const systemPrompt = `
Task: Create a student assessment/quiz.
Topic: ${config.topic}
Grade Level: ${config.gradeLevel}
Difficulty: ${config.difficulty}
Question Type: ${config.type === 'mixed' ? 'Mixed (MCQ, SRQ, ERQ)' : config.type.toUpperCase()}
Number of Questions: ${config.count}
Include Answer Key: ${config.includeKey ? 'Yes' : 'No'}

Output Format Requirements:
1. Title (H1): Assessment Title
2. Instructions (H3): Brief student instructions.
3. Questions: Numbered list.
   - For MCQs: Provide the question stem and 4 distinct options (a, b, c, d).
   - For SRQs: Provide the prompt and ample space for lines (represented by underscores).
   - For ERQs: Provide the prompt.
4. Answer Key (if requested): Provide in a separate section at the very end (H2: Answer Key). For MCQs, give the correct letter. For SRQ/ERQs, provide bullet points of expected answers.
       `;
       
       contentParts.push(systemPrompt);

       const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contentParts.join(''),
        config: {
          systemInstruction: masterPrompt,
        }
      });

      const text = response.text;

      const aiMsg: Message = {
        id: crypto.randomUUID(),
        role: 'model',
        text: text,
        timestamp: Date.now(),
        format: 'report'
      };

      setMessages(prev => [...prev, aiMsg]);

    } catch (err) {
        console.error(err);
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'model',
          text: "Error generating assessment. Please check your connection and API key.",
          timestamp: Date.now(),
          isError: true
        }]);
    } finally {
        setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    
    const apiKey = getApiKey();
    if (!apiKey) {
      setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'user',
          text: input,
          timestamp: Date.now()
      }]);
      setTimeout(() => {
          setMessages(prev => [...prev, {
              id: crypto.randomUUID(),
              role: 'model',
              text: "⚠️ **System Error**: API Key is missing. Please check your environment variables (VITE_API_KEY or API_KEY).",
              timestamp: Date.now(),
              isError: true
          }]);
      }, 500);
      setInput('');
      return;
    }

    const activeDoc = documents.find(d => d.id === activeDocId);
    
    // User Message
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      text: input,
      timestamp: Date.now()
    };
    
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setShowWelcome(false);
    incrementStat('queries');

    try {
      const ai = new GoogleGenAI({ apiKey });
      
      // Get Format Instruction
      const formatInstruction = FORMAT_OPTIONS.find(f => f.id === selectedFormat)?.instruction || "";

      // Construct Prompt
      let systemInstruction = masterPrompt;
      if (formatInstruction) {
        systemInstruction += `\n\nOUTPUT INSTRUCTION: ${formatInstruction}`;
      }

      const contentParts = [];
      
      if (activeDoc) {
        contentParts.push(`DOCUMENT CONTENT (${activeDoc.name}):\n${activeDoc.content.substring(0, 30000)}... [truncated if too long]\n\n`);
      } else {
        contentParts.push("No specific document is currently active. Answer based on general knowledge.\n\n");
      }
      
      contentParts.push(`USER QUERY: ${userMsg.text}`);

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contentParts.join(''),
        config: {
          systemInstruction: systemInstruction,
        }
      });

      const text = response.text;

      const aiMsg: Message = {
        id: crypto.randomUUID(),
        role: 'model',
        text: text,
        timestamp: Date.now(),
        format: selectedFormat
      };

      setMessages(prev => [...prev, aiMsg]);

    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'model',
        text: "I encountered an error while processing your request. Please check your network connection or API key.",
        timestamp: Date.now(),
        isError: true
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = (msg: Message, format: 'txt' | 'doc' | 'pdf' | 'csv') => {
    if (format === 'txt') {
        const blob = new Blob([msg.text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `response-${msg.id.slice(0,6)}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    } else if (format === 'doc') {
        const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Export HTML To Doc</title></head><body>";
        const footer = "</body></html>";
        // Convert Markdown to HTML for the doc (using marked)
        const html = window.marked ? window.marked.parse(msg.text) : msg.text;
        const sourceHTML = header + html + footer;
        
        const blob = new Blob(['\ufeff', sourceHTML], { type: 'application/msword' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `response-${msg.id.slice(0,6)}.doc`;
        a.click();
        URL.revokeObjectURL(url);
    } else if (format === 'pdf') {
        const doc = new window.jspdf.jsPDF();
        const splitText = doc.splitTextToSize(msg.text, 180);
        doc.text(splitText, 10, 10);
        doc.save(`response-${msg.id.slice(0,6)}.pdf`);
    } else if (format === 'csv') {
        // Simple CSV extraction from Markdown tables
        // This is a basic implementation that attempts to find the first markdown table
        const tableRegex = /\|(.+)\|[\r\n]+\|([-:|\s]+)\|[\r\n]+((?:\|.+\|[\r\n]+)+)/;
        const match = msg.text.match(tableRegex);
        
        if (match) {
            const headerRow = match[1];
            const bodyRows = match[3];
            
            const processRow = (row: string) => row.split('|').filter(cell => cell.trim() !== '').map(cell => `"${cell.trim()}"`).join(',');
            
            let csvContent = processRow(headerRow) + '\n';
            
            const rows = bodyRows.trim().split('\n');
            rows.forEach(row => {
               csvContent += processRow(row) + '\n';
            });
            
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `data-table-${msg.id.slice(0,6)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } else {
            alert("No table found in this response to export as CSV.");
        }
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    // Could add toast here
  };

  // --- Render ---
  
  // 1. Auth Check
  if (!currentUser) {
    return <AuthScreen onLogin={handleLogin} />;
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden font-sans text-gray-900 dark:text-gray-100 transition-colors duration-300">
      
      {/* Admin Panel Modal */}
      {showAdminPanel && (
          <AdminDashboard 
            isOpen={showAdminPanel} 
            onClose={() => setShowAdminPanel(false)} 
            currentUser={currentUser}
          />
      )}

      {/* Rubric Generator Modal */}
      {showRubricModal && (
          <RubricGeneratorModal
            isOpen={showRubricModal}
            onClose={() => setShowRubricModal(false)}
            onGenerate={handleGenerateRubric}
            activeDocName={documents.find(d => d.id === activeDocId)?.name || null}
          />
      )}

      {/* Lesson Plan Generator Modal */}
      {showLessonModal && (
          <LessonPlanModal
            isOpen={showLessonModal}
            onClose={() => setShowLessonModal(false)}
            onGenerate={handleGenerateLessonPlan}
            activeDocName={documents.find(d => d.id === activeDocId)?.name || null}
          />
      )}

      {/* Assessment Generator Modal */}
      {showAssessmentModal && (
          <AssessmentGeneratorModal
            isOpen={showAssessmentModal}
            onClose={() => setShowAssessmentModal(false)}
            onGenerate={handleGenerateAssessment}
            activeDocName={documents.find(d => d.id === activeDocId)?.name || null}
          />
      )}

      {/* Mobile Sidebar Backdrop */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar - Responsive Navigation */}
      <div className={`
        fixed lg:static inset-y-0 left-0 z-40
        flex flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 shadow-xl lg:shadow-none
        transition-all duration-300 ease-in-out transform
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        ${isSidebarCollapsed ? 'lg:w-20' : 'lg:w-80'}
        w-80 h-full
      `}>
        
        {/* Sidebar Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex justify-between items-center h-20">
          <div className={`flex items-center gap-3 transition-opacity duration-200 ${isSidebarCollapsed ? 'lg:opacity-0 lg:hidden' : 'opacity-100'}`}>
             <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-indigo-600 flex items-center justify-center text-white font-bold shadow-lg shadow-primary-500/30">
                E
             </div>
             <div>
                 <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300">Edtech AI</h1>
                 <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">Smart Education OS</p>
             </div>
          </div>
          
          {/* Collapse Toggle (Desktop) */}
          <button 
             onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
             className="hidden lg:flex p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 transition-colors"
          >
             {isSidebarCollapsed ? (
                 <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg">E</div>
             ) : (
                <IconMenu />
             )}
          </button>

          {/* Close Button (Mobile) */}
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="lg:hidden p-2 text-gray-500"
          >
            <IconClose />
          </button>
        </div>

        {/* User Profile Snippet */}
        <div className="px-4 py-4 border-b border-gray-200 dark:border-gray-700">
           <div className={`flex items-center gap-3 ${isSidebarCollapsed ? 'justify-center' : ''}`}>
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-accent-400 to-emerald-600 flex items-center justify-center text-white font-bold text-sm shadow-md flex-shrink-0">
                 {currentUser.name.charAt(0)}
              </div>
              {!isSidebarCollapsed && (
                <div className="flex-1 min-w-0 animate-fadeIn">
                   <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{currentUser.name}</p>
                   <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[120px]">{currentUser.email}</span>
                      {currentUser.role === 'admin' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
                              ADMIN
                          </span>
                      )}
                   </div>
                </div>
              )}
           </div>
           
           {!isSidebarCollapsed && currentUser.role === 'admin' && (
              <button 
                onClick={() => { setShowAdminPanel(true); setIsSidebarOpen(false); }}
                className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-white bg-gray-900 dark:bg-gray-700 hover:bg-gray-800 dark:hover:bg-gray-600 rounded-lg transition-colors animate-fadeIn"
              >
                 <IconShield />
                 Admin Panel
              </button>
           )}
        </div>

        {/* AI Tools Section */}
        <div className="px-4 py-4 border-b border-gray-200 dark:border-gray-700 space-y-2 overflow-y-auto max-h-48">
           {!isSidebarCollapsed && <h3 className="px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 animate-fadeIn">AI Tools</h3>}
           
           <button 
             onClick={() => { setShowRubricModal(true); setIsSidebarOpen(false); }}
             title="Rubric Generator"
             className={`w-full flex items-center gap-2 p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-all text-sm font-medium border border-indigo-200 dark:border-indigo-800 ${isSidebarCollapsed ? 'justify-center' : ''}`}
           >
              <IconTable />
              {!isSidebarCollapsed && <span className="animate-fadeIn">Rubric Generator</span>}
           </button>

           <button 
             onClick={() => { setShowLessonModal(true); setIsSidebarOpen(false); }}
             title="Lesson Plan Generator"
             className={`w-full flex items-center gap-2 p-2 rounded-lg bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/30 transition-all text-sm font-medium border border-teal-200 dark:border-teal-800 ${isSidebarCollapsed ? 'justify-center' : ''}`}
           >
              <IconClipboard />
              {!isSidebarCollapsed && <span className="animate-fadeIn">Lesson Plan Generator</span>}
           </button>

           <button 
             onClick={() => { setShowAssessmentModal(true); setIsSidebarOpen(false); }}
             title="Assessment Generator"
             className={`w-full flex items-center gap-2 p-2 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-all text-sm font-medium border border-rose-200 dark:border-rose-800 ${isSidebarCollapsed ? 'justify-center' : ''}`}
           >
              <IconClipboardCheck />
              {!isSidebarCollapsed && <span className="animate-fadeIn">Quiz Generator</span>}
           </button>
        </div>

        {/* Upload Section */}
        <div className="p-4">
          <label className={`flex flex-col items-center justify-center w-full ${isSidebarCollapsed ? 'h-16' : 'h-24'} border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer bg-gray-50 dark:bg-gray-700/30 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-all group`}>
            <div className="flex flex-col items-center justify-center pt-2 pb-3 text-center">
              {isProcessingFile ? (
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
              ) : (
                <div className="text-gray-400 group-hover:text-primary-500 transition-colors">
                   <IconUpload />
                </div>
              )}
              {!isSidebarCollapsed && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 font-medium group-hover:text-primary-600 dark:group-hover:text-primary-400 animate-fadeIn">
                    {isProcessingFile ? '...' : 'Upload File'}
                  </p>
              )}
            </div>
            <input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={handleFileUpload} disabled={isProcessingFile} />
          </label>
          {fileError && !isSidebarCollapsed && <p className="mt-2 text-xs text-red-500 text-center animate-pulse">{fileError}</p>}
        </div>

        {/* Document List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
          {!isSidebarCollapsed && <h3 className="px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 animate-fadeIn">Documents</h3>}
          {documents.length === 0 ? (
             !isSidebarCollapsed && (
                 <div className="text-center py-8 text-gray-400 text-sm italic animate-fadeIn">
                    No documents yet.
                 </div>
             )
          ) : (
            documents.map(doc => (
              <div 
                key={doc.id}
                onClick={() => { setActiveDocId(doc.id); setIsSidebarOpen(false); }}
                title={doc.name}
                className={`group flex items-center p-3 rounded-xl cursor-pointer transition-all border ${
                  activeDocId === doc.id 
                    ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800 shadow-sm' 
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700/50 border-transparent'
                } ${isSidebarCollapsed ? 'justify-center' : ''}`}
              >
                <div className="flex-shrink-0">
                  <IconFile type={doc.type} />
                </div>
                {!isSidebarCollapsed && (
                    <div className="flex-1 min-w-0 ml-3 animate-fadeIn">
                      <p className={`text-sm font-medium truncate ${
                        activeDocId === doc.id ? 'text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300'
                      }`}>
                        {doc.name}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {formatBytes(doc.size)}
                      </p>
                    </div>
                )}
                {!isSidebarCollapsed && (
                    <button 
                      onClick={(e) => handleDeleteDoc(doc.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all"
                    >
                      <IconTrash />
                    </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
           <button 
             onClick={handleLogout}
             title="Sign Out"
             className={`flex items-center justify-center w-full gap-2 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors ${isSidebarCollapsed ? 'px-0' : ''}`}
           >
             <IconLogout />
             {!isSidebarCollapsed && <span className="animate-fadeIn">Sign Out</span>}
           </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 relative h-full">
        
        {/* Header */}
        <header className="h-16 border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 backdrop-blur-md flex items-center justify-between px-4 lg:px-6 sticky top-0 z-20">
          <div className="flex items-center gap-3">
             {/* Mobile Menu Toggle */}
             <button 
                onClick={() => setIsSidebarOpen(true)}
                className="lg:hidden p-2 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
             >
                <IconMenu />
             </button>
             
             <div className="flex items-center text-sm breadcrumbs text-gray-500 overflow-hidden">
                <span className="font-medium text-gray-900 dark:text-white hidden sm:inline">Workspace</span>
                <span className="mx-2 hidden sm:inline">/</span>
                {activeDocId ? (
                   <span className="text-primary-600 dark:text-primary-400 truncate max-w-[150px] sm:max-w-xs font-medium">
                     {documents.find(d => d.id === activeDocId)?.name}
                   </span>
                ) : (
                   <span>General Chat</span>
                )}
             </div>
          </div>

          <div className="flex items-center space-x-2 md:space-x-4">
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="Toggle Theme"
            >
              {isDarkMode ? <IconSun /> : <IconMoon />}
            </button>
            
            {/* Master Prompt Settings - ADMIN ONLY */}
            {currentUser?.role === 'admin' && (
              <>
                <div className="h-6 w-px bg-gray-300 dark:bg-gray-700 mx-2 hidden sm:block"></div>
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className={`p-2 rounded-lg transition-colors flex items-center gap-2 ${
                    showSettings 
                      ? 'bg-green-900/20 text-green-600 dark:text-green-400' 
                      : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                  title="Neural Core Configuration"
                >
                  <IconCpu />
                  <span className="hidden md:inline text-sm font-medium">Neural Core</span>
                </button>
              </>
            )}
          </div>
        </header>

        {/* NEURAL CORE VAULT - ADMIN ONLY */}
        {showSettings && currentUser?.role === 'admin' && (
          <div className="bg-gray-900 border-b border-gray-700 p-6 shadow-2xl animate-slideDown absolute top-16 left-0 right-0 z-30 text-green-500 font-mono">
            <div className="max-w-5xl mx-auto">
              <div className="flex justify-between items-start mb-6 border-b border-green-900/50 pb-4">
                  <div>
                    <h2 className="text-xl font-bold flex items-center gap-3 tracking-wider">
                      <IconCpu />
                      NEURAL CORE_V2.1
                    </h2>
                    <p className="text-xs text-green-600 mt-1 uppercase tracking-widest">
                        System Intelligence Configuration // Root Access Granted
                    </p>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1 rounded bg-green-900/20 border border-green-900/50">
                    {isCoreUnlocked ? <IconUnlock /> : <IconLock />}
                    <span className="text-xs font-bold">{isCoreUnlocked ? 'WRITE_MODE' : 'READ_ONLY_MODE'}</span>
                  </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-4">
                    <div className="relative group">
                        <div className={`absolute inset-0 bg-green-500/5 rounded-lg pointer-events-none transition-opacity ${isCoreUnlocked ? 'opacity-0' : 'opacity-100'}`}></div>
                        <textarea
                          value={masterPrompt}
                          readOnly={!isCoreUnlocked}
                          onChange={(e) => setMasterPrompt(e.target.value)}
                          className={`w-full h-96 p-4 rounded-lg bg-black/50 border-2 font-mono text-sm resize-none focus:outline-none transition-all
                            ${isCoreUnlocked 
                              ? 'border-green-500 text-green-400 shadow-[0_0_20px_rgba(34,197,94,0.1)]' 
                              : 'border-gray-800 text-gray-500 cursor-not-allowed'
                            }
                          `}
                          spellCheck={false}
                        />
                        {!isCoreUnlocked && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="bg-black/80 border border-gray-700 p-3 rounded text-gray-400 flex items-center gap-2 backdrop-blur-sm">
                                <IconLock /> 
                                <span>LOCKED: Authenticate to Edit</span>
                            </div>
                          </div>
                        )}
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="p-4 rounded border border-green-900/50 bg-green-900/10">
                        <h3 className="text-sm font-bold mb-2 text-green-400 uppercase">Directives</h3>
                        <ul className="text-xs space-y-2 text-green-600/80 list-disc pl-4">
                          <li>This prompt is the persistent DNA of the application.</li>
                          <li>Changes here override default system behaviors immediately.</li>
                          <li>Stored in browser Secure Storage (Local).</li>
                          <li>Persists across deployments unless cache is purged.</li>
                        </ul>
                    </div>

                    <div className="space-y-3 pt-4 border-t border-green-900/30">
                        {!isCoreUnlocked ? (
                          <button 
                            onClick={() => setIsCoreUnlocked(true)}
                            className="w-full py-3 bg-green-900/20 hover:bg-green-500 hover:text-black border border-green-500/50 text-green-500 font-bold rounded transition-all uppercase tracking-widest flex items-center justify-center gap-2 group"
                          >
                            <IconUnlock />
                            Unlock Core
                          </button>
                        ) : (
                          <button 
                            onClick={saveMasterPrompt}
                            className="w-full py-3 bg-green-500 hover:bg-green-400 text-black font-bold rounded shadow-[0_0_15px_rgba(34,197,94,0.4)] transition-all uppercase tracking-widest flex items-center justify-center gap-2 animate-pulse"
                          >
                            <IconLock />
                            Save & Lock Core
                          </button>
                        )}
                        
                        <button 
                          onClick={() => { setShowSettings(false); setIsCoreUnlocked(false); }}
                          className="w-full py-2 text-xs text-green-700 hover:text-green-500 uppercase tracking-wider transition-colors"
                        >
                          Close Terminal
                        </button>
                    </div>
                    
                    {isCoreUnlocked && (
                        <div className="text-center pt-4">
                            <button 
                              onClick={() => { if(confirm("Revert to factory default prompt?")) setMasterPrompt(DEFAULT_MASTER_PROMPT); }}
                              className="text-[10px] text-red-500/50 hover:text-red-500 hover:underline decoration-red-500/30 transition-all uppercase"
                            >
                              [DANGER] Restore Factory Default
                            </button>
                        </div>
                    )}
                  </div>
              </div>
            </div>
          </div>
        )}

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth" id="chat-container">
          <div className="max-w-4xl mx-auto space-y-6 pb-4">
            
            {/* Welcome State */}
            {showWelcome && (
              <div className="flex flex-col items-center justify-center py-10 md:py-20 text-center animate-fadeIn">
                <div className="w-16 h-16 md:w-20 md:h-20 bg-gradient-to-tr from-primary-100 to-indigo-100 dark:from-primary-900/20 dark:to-indigo-900/20 rounded-3xl flex items-center justify-center mb-6 shadow-xl">
                   <IconBot />
                </div>
                <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-3 px-4">
                  How can I help you today?
                </h2>
                <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto text-base md:text-lg leading-relaxed px-4">
                  Upload a lesson plan, rubric, or document to the left, or just ask me anything about pedagogy or curriculum design.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-8 w-full max-w-2xl px-4">
                   {[
                      'Create a 5E Lesson Plan', 
                      'Generate Bloom\'s Taxonomy questions', 
                      'Draft a rubric for this assignment', 
                      'Create a quiz for 5th grade History'
                   ].map((hint) => (
                      <button 
                        key={hint}
                        onClick={() => { setInput(hint); }}
                        className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-primary-400 dark:hover:border-primary-500 hover:shadow-md transition-all text-left text-sm font-medium text-gray-600 dark:text-gray-300"
                      >
                        {hint} →
                      </button>
                   ))}
                </div>
              </div>
            )}

            {/* Messages */}
            {messages.map((msg) => (
              <div 
                key={msg.id} 
                className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-slideUp`}
              >
                {msg.role === 'model' && (
                  <div className="hidden sm:flex w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-indigo-600 items-center justify-center flex-shrink-0 mt-1 shadow-md">
                    <span className="text-white text-xs font-bold">AI</span>
                  </div>
                )}
                
                <div 
                  className={`max-w-[95%] sm:max-w-[85%] rounded-2xl p-4 sm:p-5 shadow-sm ${
                    msg.role === 'user' 
                      ? 'bg-primary-600 text-white rounded-tr-sm' 
                      : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-tl-sm text-gray-800 dark:text-gray-100'
                  } ${msg.isError ? 'border-red-500 bg-red-50 dark:bg-red-900/20' : ''}`}
                >
                  <div className="markdown-body">
                    {msg.role === 'user' ? (
                       <p className="whitespace-pre-wrap leading-relaxed text-sm md:text-base">{msg.text}</p>
                    ) : (
                       <MarkdownContent content={msg.text} />
                    )}
                  </div>
                  
                  {/* Message Actions */}
                  {msg.role === 'model' && !msg.isError && (
                    <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/50">
                      <button 
                        onClick={() => handleCopy(msg.text)}
                        className="text-xs flex items-center gap-1 text-gray-400 hover:text-primary-500 transition-colors px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        <IconCopy /> Copy
                      </button>
                      <div className="h-3 w-px bg-gray-200 dark:bg-gray-700 hidden sm:block"></div>
                      <span className="text-xs text-gray-400 px-1 hidden sm:block">Download:</span>
                      <button onClick={() => handleDownload(msg, 'doc')} className="text-xs font-medium text-blue-500 hover:underline px-2 py-1">DOC</button>
                      <button onClick={() => handleDownload(msg, 'pdf')} className="text-xs font-medium text-red-500 hover:underline px-2 py-1">PDF</button>
                      <button onClick={() => handleDownload(msg, 'txt')} className="text-xs font-medium text-gray-500 hover:underline px-2 py-1">TXT</button>
                      {(msg.format === 'table' || msg.text.includes('|')) && (
                          <button onClick={() => handleDownload(msg, 'csv')} className="text-xs font-medium text-green-500 hover:underline px-2 py-1">CSV (Sheet)</button>
                      )}
                    </div>
                  )}
                </div>

                {msg.role === 'user' && (
                   <div className="hidden sm:flex w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 items-center justify-center flex-shrink-0 mt-1">
                      <IconUser />
                   </div>
                )}
              </div>
            ))}
            
            {isLoading && (
              <div className="flex gap-4 justify-start animate-pulse">
                 <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0 hidden sm:block"></div>
                 <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl rounded-tl-sm border border-gray-200 dark:border-gray-700 shadow-sm flex items-center gap-2">
                    <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce delay-75"></div>
                    <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce delay-150"></div>
                 </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="p-4 md:p-6 bg-white/90 dark:bg-gray-900/90 backdrop-blur-lg border-t border-gray-200 dark:border-gray-700 shrink-0 z-20">
           <div className="max-w-4xl mx-auto">
             {/* Format Selection Toolbar */}
             <div className="flex gap-2 mb-3 overflow-x-auto pb-1 scrollbar-hide">
               {FORMAT_OPTIONS.map(opt => (
                 <button
                   key={opt.id}
                   onClick={() => setSelectedFormat(opt.id)}
                   className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                      selectedFormat === opt.id
                      ? 'bg-primary-600 text-white shadow-md shadow-primary-500/20'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 border border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                   }`}
                 >
                   {selectedFormat === opt.id && <IconFormat />}
                   {opt.label}
                 </button>
               ))}
             </div>

             <div className="relative flex items-end gap-2 bg-gray-50 dark:bg-gray-800 p-2 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent transition-all">
                <textarea 
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Type a message..."
                  className="w-full max-h-32 bg-transparent border-none focus:ring-0 resize-none py-3 px-3 text-sm dark:text-white placeholder-gray-400"
                  rows={1}
                  style={{ minHeight: '44px' }}
                />
                <button 
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="p-3 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-xl transition-all shadow-md disabled:shadow-none mb-0.5 shrink-0"
                >
                  {isLoading ? (
                     <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  ) : (
                     <IconSend />
                  )}
                </button>
             </div>
             <p className="text-center text-[10px] md:text-xs text-gray-400 mt-2">
               AI can make mistakes. Verify important information.
             </p>
           </div>
        </div>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);