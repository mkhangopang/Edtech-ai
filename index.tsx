import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// --- Types ---
type PlanType = 'free' | 'pro' | 'campus';

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
  password: string;
  name: string;
  role: 'user' | 'admin';
  plan: PlanType;
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
const PLAN_LIMITS = {
  free: { maxDocs: 1, maxSizeMB: 5, label: 'Free Tier' },
  pro: { maxDocs: 10, maxSizeMB: 20, label: 'Educator Pro' },
  campus: { maxDocs: 999, maxSizeMB: 50, label: 'Campus Plan' }
};

// CORE MASTER PROMPT
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

const STORAGE_KEYS = {
  USERS: 'edtech_users_v5',
  SESSION: 'edtech_session_v5',
  PROMPT: 'edtech_prompt_v5',
  STATS: 'edtech_stats_v5',
  DOCS_PREFIX: 'edtech_docs_v5_' // Suffix with userID
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
const IconMenu = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>;
const IconClose = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
const IconUpload = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>;
const IconFile = ({ type }: { type: string }) => {
  let colorClass = "text-gray-400";
  if (type === 'pdf') colorClass = "text-red-400";
  if (type === 'docx') colorClass = "text-blue-400";
  return <svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 ${colorClass}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 011.414.586l5.414 5.414a1 1 0 01.586 1.414V19a2 2 0 01-2 2z" /></svg>;
};
const IconTrash = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>;
const IconSettings = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>;
const IconCpu = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" /></svg>;
const IconLock = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>;
const IconUnlock = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" /></svg>;
const IconSend = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>;
const IconMoon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" /></svg>;
const IconSun = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" /></svg>;
const IconBot = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>;
const IconDownload = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>;
const IconCopy = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>;
const IconFormat = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" /></svg>;
const IconLogout = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" /></svg>;
const IconUser = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg>;
const IconShield = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>;
const IconTable = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7-4h14M4 6h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" /></svg>;
const IconClipboard = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>;
const IconClipboardCheck = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>;
const IconSparkles = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" /></svg>;
const IconCheck = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>;
const IconXCircle = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>;
const IconStar = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>;

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
  if (!window.pdfjsLib) throw new Error("PDF Library not loaded.");
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    fullText += textContent.items.map((item: any) => item.str).join(" ") + "\n\n";
  }
  return fullText;
};

const extractTextFromDOCX = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  if (!window.mammoth) throw new Error("DOCX Library not loaded.");
  const result = await window.mammoth.extractRawText({ arrayBuffer: arrayBuffer });
  return result.value;
};

// Safe API Key retrieval
const getApiKey = (): string | undefined => {
    try {
        if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
            return process.env.API_KEY;
        }
        // @ts-ignore
        if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_KEY) {
            // @ts-ignore
            return import.meta.env.VITE_API_KEY;
        }
        return undefined;
    } catch (e) {
        return undefined;
    }
};

// --- Auth Helpers ---
const getStoredUsers = (): User[] => {
  try {
    const usersStr = localStorage.getItem(STORAGE_KEYS.USERS);
    return usersStr ? JSON.parse(usersStr) : [];
  } catch (e) { return []; }
};

const saveUser = (user: User) => {
  const users = getStoredUsers();
  const index = users.findIndex(u => u.id === user.id || u.email.toLowerCase() === user.email.toLowerCase());
  if (index === -1) { users.push(user); } else { users[index] = user; }
  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
};

const getSession = (): User | null => {
  try {
    const sessionStr = localStorage.getItem(STORAGE_KEYS.SESSION);
    return sessionStr ? JSON.parse(sessionStr) : null;
  } catch (e) { return null; }
};

const setSession = (user: User) => {
  localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(user));
};

const clearSession = () => {
  localStorage.removeItem(STORAGE_KEYS.SESSION);
};

// --- Doc Storage Helpers ---
const getUserDocsKey = (userId: string) => `${STORAGE_KEYS.DOCS_PREFIX}${userId}`;
const getStoredDocs = (userId: string): DocumentFile[] => {
  try {
    const docsStr = localStorage.getItem(getUserDocsKey(userId));
    return docsStr ? JSON.parse(docsStr) : [];
  } catch (e) { return []; }
};
const saveStoredDocs = (userId: string, docs: DocumentFile[]) => {
  localStorage.setItem(getUserDocsKey(userId), JSON.stringify(docs));
};

// --- Stats Helpers ---
const getSystemStats = () => {
  const statsStr = localStorage.getItem(STORAGE_KEYS.STATS);
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
  { id: 'report', label: 'Pro Report', instruction: "Format the response as a professional report. Use H1 for the main title, H2 for sections, bullet points for lists, and bold for key insights. Ensure the tone is formal and structured." },
  { id: 'table', label: 'Data Table', instruction: "Present the answer primarily as a Markdown table. If there is data to compare or list, use columns and rows. Ensure headers are clear." },
  { id: 'concise', label: 'Concise Summary', instruction: "Provide a very brief, high-level summary. Use bullet points. Keep it under 200 words if possible. Focus on the 'Bottom Line Up Front' (BLUF)." },
  { id: 'step', label: 'Step-by-Step', instruction: "Break the answer down into a numbered step-by-step guide. Use bold numbering (e.g., Step 1:) and clear instructions." }
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
  return <div className="markdown-body text-gray-800 dark:text-gray-200" dangerouslySetInnerHTML={{ __html: html }} />;
};

const PricingModal = ({ isOpen, onClose, onUpgrade, currentPlan }: { isOpen: boolean, onClose: () => void, onUpgrade: (plan: PlanType) => void, currentPlan: PlanType }) => {
    if (!isOpen) return null;
    
    const plans = [
        {
            id: 'free' as PlanType,
            name: 'Starter',
            price: 'Free',
            features: ['1 Document Slot', '5MB File Size Limit', 'Basic AI Models', 'Community Support'],
            color: 'bg-gray-100 dark:bg-gray-700',
            btnColor: 'bg-gray-800 hover:bg-gray-900',
            recommended: false
        },
        {
            id: 'pro' as PlanType,
            name: 'Educator Pro',
            price: '$9.99/mo',
            features: ['10 Document Slots', '20MB File Size Limit', 'Advanced Reasoning Models', 'Priority Generation', 'Export to PDF/Word'],
            color: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200',
            btnColor: 'bg-indigo-600 hover:bg-indigo-700',
            recommended: true
        },
        {
            id: 'campus' as PlanType,
            name: 'Campus Plan',
            price: '$29.99/mo',
            features: ['Unlimited Documents', '50MB File Size Limit', 'Team Sharing (Beta)', 'Dedicated Support', 'Custom Rubrics'],
            color: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200',
            btnColor: 'bg-purple-600 hover:bg-purple-700',
            recommended: false
        }
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden border border-gray-200 dark:border-gray-700 flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-800/50">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Upgrade Your Workspace</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Unlock more power, storage, and advanced AI features.</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-gray-500"><IconClose /></button>
                </div>
                <div className="p-6 md:p-8 overflow-y-auto bg-gray-50 dark:bg-gray-900">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {plans.map((plan) => (
                            <div key={plan.id} className={`relative rounded-xl p-6 border ${plan.id === 'pro' || plan.id === 'campus' ? 'border-transparent shadow-lg' : 'border-gray-200 dark:border-gray-700'} ${plan.color} flex flex-col`}>
                                {plan.recommended && <div className="absolute top-0 right-0 bg-yellow-400 text-yellow-900 text-xs font-bold px-2 py-1 rounded-bl-lg rounded-tr-lg">RECOMMENDED</div>}
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{plan.name}</h3>
                                <div className="text-3xl font-extrabold text-gray-900 dark:text-white mt-2 mb-4">{plan.price}</div>
                                <ul className="space-y-3 mb-8 flex-1">
                                    {plan.features.map((feat, i) => (
                                        <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"><IconCheck /><span>{feat}</span></li>
                                    ))}
                                </ul>
                                <button onClick={() => onUpgrade(plan.id)} disabled={currentPlan === plan.id} className={`w-full py-2.5 rounded-lg text-white font-medium transition-all ${plan.btnColor} ${currentPlan === plan.id ? 'opacity-50 cursor-default' : 'shadow-md hover:shadow-lg'}`}>
                                    {currentPlan === plan.id ? 'Current Plan' : 'Select Plan'}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

const AuthScreen = ({ onLogin }: { onLogin: (user: User) => void }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [role, setRole] = useState<'user' | 'admin'>('user');
    const [error, setError] = useState('');

    useEffect(() => {
        const users = getStoredUsers();
        if (!users.some(u => u.email === 'admin@edtech.ai')) {
            saveUser({ id: 'default-admin-id', email: 'admin@edtech.ai', password: 'admin', name: 'System Admin', role: 'admin', plan: 'campus', joinedDate: Date.now() });
        }
    }, []);

    const handleResetData = () => {
        if (confirm("FACTORY RESET WARNING:\n\nThis will delete ALL local accounts, documents, and settings. Continue?")) {
            localStorage.clear();
            window.location.reload();
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!email || !password) { setError('Please fill in all fields'); return; }
        
        const cleanEmail = email.trim().toLowerCase();
        if (isLogin) {
            const user = getStoredUsers().find(u => u.email.toLowerCase() === cleanEmail && u.password === password.trim());
            if (user) { setSession(user); onLogin(user); } else { setError('Invalid credentials. (Try admin@edtech.ai / admin)'); }
        } else {
            if (getStoredUsers().find(u => u.email.toLowerCase() === cleanEmail)) { setError('User already exists'); return; }
            if (!name) { setError('Name is required'); return; }
            const newUser: User = { id: crypto.randomUUID(), email: cleanEmail, password: password.trim(), name: name.trim(), role, plan: 'free', joinedDate: Date.now() };
            saveUser(newUser); setSession(newUser);
            setTimeout(() => onLogin(newUser), 50);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 font-sans">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl flex overflow-hidden border border-gray-200 dark:border-gray-700 min-h-[600px]">
                <div className="w-1/2 bg-gradient-to-br from-primary-600 to-indigo-800 p-12 hidden md:flex flex-col justify-between relative overflow-hidden">
                    <div className="relative z-10">
                        <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center mb-6 shadow-lg"><span className="text-2xl font-bold text-primary-600">E</span></div>
                        <h1 className="text-4xl font-bold text-white mb-4 leading-tight">Unlock the power of your educational content.</h1>
                        <p className="text-primary-100 text-lg">Edtech AI transforms static files into interactive knowledge bases.</p>
                    </div>
                </div>
                <div className="w-full md:w-1/2 p-8 md:p-12 flex flex-col justify-center bg-white dark:bg-gray-800 relative">
                    <div className="max-w-md mx-auto w-full">
                        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{isLogin ? 'Welcome Back' : 'Create Account'}</h2>
                        <form onSubmit={handleSubmit} className="space-y-5">
                            {!isLogin && <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white" /></div>}
                            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white" /></div>
                            <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white" /></div>
                            {!isLogin && <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Role</label><select value={role} onChange={(e) => setRole(e.target.value as any)} className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 outline-none dark:text-white"><option value="user">User</option><option value="admin">Admin</option></select></div>}
                            {error && <p className="text-red-500 text-sm">{error}</p>}
                            <button type="submit" className="w-full bg-primary-600 hover:bg-primary-700 text-white font-semibold py-3 rounded-lg shadow-lg transition-all">{isLogin ? 'Sign In' : 'Sign Up'}</button>
                        </form>
                        <div className="mt-8 text-center text-sm text-gray-500"><button onClick={() => { setIsLogin(!isLogin); setError(''); }} className="text-primary-600 hover:underline">{isLogin ? 'Create an account' : 'Back to login'}</button></div>
                        <div className="absolute bottom-4 right-4"><button onClick={handleResetData} className="text-[10px] text-gray-300 hover:text-red-400 flex items-center gap-1"><IconTrash /> Reset App Data</button></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const RubricGeneratorModal = ({ isOpen, onClose, onGenerate, activeDocName }: { isOpen: boolean, onClose: () => void, onGenerate: (config: RubricConfig) => void, activeDocName: string | null }) => {
    const [config, setConfig] = useState<RubricConfig>({ assignment: '', gradeLevel: '9th Grade', scale: '4', bloomsLevel: 'Applying', objectives: '', useActiveDoc: !!activeDocName });
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700 flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex justify-between items-center">
                    <div className="flex items-center gap-3"><div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400"><IconTable /></div><h2 className="text-lg font-bold text-gray-900 dark:text-white">Rubric Generator</h2></div>
                    <button onClick={onClose}><IconClose /></button>
                </div>
                <div className="p-6 space-y-4 overflow-y-auto">
                    <div><label className="block text-sm font-medium mb-1 dark:text-gray-300">Assignment</label><textarea value={config.assignment} onChange={e => setConfig({...config, assignment: e.target.value})} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white" rows={2} /></div>
                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="block text-sm font-medium mb-1 dark:text-gray-300">Grade Level</label><select value={config.gradeLevel} onChange={e => setConfig({...config, gradeLevel: e.target.value})} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white"><option>Elementary</option><option>Middle School</option><option>High School</option><option>Undergrad</option></select></div>
                        <div><label className="block text-sm font-medium mb-1 dark:text-gray-300">Scale</label><select value={config.scale} onChange={e => setConfig({...config, scale: e.target.value as any})} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white"><option value="3">3-Point</option><option value="4">4-Point</option><option value="5">5-Point</option></select></div>
                    </div>
                    <div><label className="block text-sm font-medium mb-1 dark:text-gray-300">Bloom's Level</label><select value={config.bloomsLevel} onChange={e => setConfig({...config, bloomsLevel: e.target.value})} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white">{BLOOMS_LEVELS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}</select></div>
                    {activeDocName && <div className="flex items-center gap-2 pt-2"><input type="checkbox" checked={config.useActiveDoc} onChange={e => setConfig({...config, useActiveDoc: e.target.checked})} /><label className="text-sm dark:text-gray-300">Use active document context</label></div>}
                </div>
                <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">Cancel</button>
                    <button onClick={() => onGenerate(config)} disabled={!config.assignment} className="px-5 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">Generate</button>
                </div>
            </div>
        </div>
    );
};

const AssessmentGeneratorModal = ({ isOpen, onClose, onGenerate, activeDocName }: { isOpen: boolean, onClose: () => void, onGenerate: (config: AssessmentConfig) => void, activeDocName: string | null }) => {
    const [config, setConfig] = useState<AssessmentConfig>({ type: 'mixed', topic: '', gradeLevel: '9th Grade', difficulty: 'medium', count: 10, includeKey: true, useActiveDoc: !!activeDocName });
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700 flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex justify-between items-center">
                    <div className="flex items-center gap-3"><div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400"><IconClipboardCheck /></div><h2 className="text-lg font-bold text-gray-900 dark:text-white">Assessment Generator</h2></div>
                    <button onClick={onClose}><IconClose /></button>
                </div>
                <div className="p-6 space-y-4 overflow-y-auto">
                    <div><label className="block text-sm font-medium mb-1 dark:text-gray-300">Topic</label><input type="text" value={config.topic} onChange={e => setConfig({...config, topic: e.target.value})} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white" /></div>
                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="block text-sm font-medium mb-1 dark:text-gray-300">Type</label><select value={config.type} onChange={e => setConfig({...config, type: e.target.value as any})} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white"><option value="mixed">Mixed</option><option value="mcq">MCQ</option><option value="srq">Short Resp</option><option value="erq">Essay</option></select></div>
                        <div><label className="block text-sm font-medium mb-1 dark:text-gray-300">Count</label><input type="number" value={config.count} onChange={e => setConfig({...config, count: parseInt(e.target.value)})} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white" /></div>
                    </div>
                    {activeDocName && <div className="flex items-center gap-2 pt-2"><input type="checkbox" checked={config.useActiveDoc} onChange={e => setConfig({...config, useActiveDoc: e.target.checked})} /><label className="text-sm dark:text-gray-300">Use active document context</label></div>}
                </div>
                <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">Cancel</button>
                    <button onClick={() => onGenerate(config)} disabled={!config.topic && !config.useActiveDoc} className="px-5 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">Generate</button>
                </div>
            </div>
        </div>
    );
};

const LessonPlanModal = ({ isOpen, onClose, onGenerate, activeDocName }: { isOpen: boolean, onClose: () => void, onGenerate: (config: LessonConfig) => void, activeDocName: string | null }) => {
    const [config, setConfig] = useState<LessonConfig>({ templateId: '5e', topic: '', gradeLevel: '9th Grade', duration: '60 min', objectives: '', standards: '', useActiveDoc: !!activeDocName });
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700 flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex justify-between items-center">
                    <div className="flex items-center gap-3"><div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400"><IconClipboard /></div><h2 className="text-lg font-bold text-gray-900 dark:text-white">Lesson Planner</h2></div>
                    <button onClick={onClose}><IconClose /></button>
                </div>
                <div className="p-6 space-y-4 overflow-y-auto">
                    <div><label className="block text-sm font-medium mb-1 dark:text-gray-300">Topic</label><input type="text" value={config.topic} onChange={e => setConfig({...config, topic: e.target.value})} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white" /></div>
                    <div><label className="block text-sm font-medium mb-1 dark:text-gray-300">Framework</label><select value={config.templateId} onChange={e => setConfig({...config, templateId: e.target.value})} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white">{LESSON_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
                    {activeDocName && <div className="flex items-center gap-2 pt-2"><input type="checkbox" checked={config.useActiveDoc} onChange={e => setConfig({...config, useActiveDoc: e.target.checked})} /><label className="text-sm dark:text-gray-300">Use active document context</label></div>}
                </div>
                <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">Cancel</button>
                    <button onClick={() => onGenerate(config)} disabled={!config.topic} className="px-5 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">Generate</button>
                </div>
            </div>
        </div>
    );
};

const AdminDashboard = ({ isOpen, onClose, currentUser }: { isOpen: boolean, onClose: () => void, currentUser: User }) => {
    const [users, setUsers] = useState<User[]>([]);
    const [stats, setStats] = useState({ docs: 0, queries: 0 });
    useEffect(() => { if (isOpen) { setUsers(getStoredUsers()); setStats(getSystemStats()); } }, [isOpen]);
    const handleDeleteUser = (id: string) => { if (confirm("Delete user?")) { const u = users.filter(x => x.id !== id); localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(u)); setUsers(u); } };
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-gray-900 w-full max-w-5xl h-[80vh] rounded-2xl shadow-2xl flex flex-col border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="p-6 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 flex justify-between items-center">
                    <div className="flex items-center gap-3"><IconShield /><h2 className="text-xl font-bold dark:text-white">Admin Dashboard</h2></div>
                    <button onClick={onClose}><IconClose /></button>
                </div>
                <div className="p-6 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-4 mb-8">
                        <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-xl border dark:border-gray-700"><h3>Users</h3><p className="text-2xl font-bold">{users.length}</p></div>
                        <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-xl border dark:border-gray-700"><h3>Docs</h3><p className="text-2xl font-bold">{stats.docs}</p></div>
                    </div>
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 dark:bg-gray-800 uppercase text-gray-500"><tr><th className="px-6 py-3">Name</th><th className="px-6 py-3">Email</th><th className="px-6 py-3">Role</th><th className="px-6 py-3">Action</th></tr></thead>
                        <tbody>
                            {users.map(u => (
                                <tr key={u.id} className="border-b dark:border-gray-700">
                                    <td className="px-6 py-4 dark:text-white">{u.name}</td>
                                    <td className="px-6 py-4 dark:text-gray-300">{u.email}</td>
                                    <td className="px-6 py-4">{u.role}</td>
                                    <td className="px-6 py-4"><button onClick={() => handleDeleteUser(u.id)} disabled={u.id === currentUser.id} className="text-red-500 hover:underline">Delete</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const App = () => {
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [showAdminPanel, setShowAdminPanel] = useState(false);
    const [showPricingModal, setShowPricingModal] = useState(false);
    const [documents, setDocuments] = useState<DocumentFile[]>([]);
    const [activeDocId, setActiveDocId] = useState<string | null>(null);
    const [masterPrompt, setMasterPrompt] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.PROMPT) || DEFAULT_MASTER_PROMPT);
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
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => { const s = getSession(); if (s) setCurrentUser(s); }, []);
    useEffect(() => { if (currentUser) { setSession(currentUser); const d = getStoredDocs(currentUser.id); setDocuments(d); if (d.length > 0) setActiveDocId(d[0].id); } }, [currentUser]);
    useEffect(() => { document.documentElement.classList.toggle('dark', isDarkMode); }, [isDarkMode]);
    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isLoading]);

    const handleLogin = (u: User) => setCurrentUser(u);
    const handleLogout = () => { clearSession(); setCurrentUser(null); setDocuments([]); setActiveDocId(null); setMessages([]); };
    const handleUpgrade = (plan: PlanType) => { if (currentUser) { const u = { ...currentUser, plan }; saveUser(u); setCurrentUser(u); setShowPricingModal(false); } };
    
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentUser) return;
        setIsProcessingFile(true); setFileError(null);
        try {
            const plan = PLAN_LIMITS[currentUser.plan];
            if (documents.length >= plan.maxDocs) throw new Error("Plan limit reached.");
            if (file.size > plan.maxSizeMB * 1024 * 1024) throw new Error("File too large.");
            
            let content = "";
            let type: DocumentFile['type'] = 'txt';
            if (file.name.endsWith('.pdf')) { type = 'pdf'; content = await extractTextFromPDF(file); }
            else if (file.name.endsWith('.docx')) { type = 'docx'; content = await extractTextFromDOCX(file); }
            else { content = await file.text(); }
            
            const newDoc: DocumentFile = { id: crypto.randomUUID(), name: file.name, type, content, size: file.size, uploadDate: Date.now() };
            const updated = [...documents, newDoc];
            setDocuments(updated); saveStoredDocs(currentUser.id, updated); setActiveDocId(newDoc.id); setShowWelcome(false); incrementStat('docs');
        } catch (err: any) { setFileError(err.message); } finally { setIsProcessingFile(false); e.target.value = ''; }
    };

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;
        const apiKey = getApiKey();
        if (!apiKey) { setMessages(p => [...p, { id: crypto.randomUUID(), role: 'model', text: "API Key Missing", timestamp: Date.now(), isError: true }]); return; }
        
        const activeDoc = documents.find(d => d.id === activeDocId);
        const userMsg: Message = { id: crypto.randomUUID(), role: 'user', text: input, timestamp: Date.now() };
        setMessages(p => [...p, userMsg]); setInput(''); setIsLoading(true); setShowWelcome(false); incrementStat('queries');

        try {
            const ai = new GoogleGenAI({ apiKey });
            let prompt = masterPrompt;
            const fmt = FORMAT_OPTIONS.find(f => f.id === selectedFormat)?.instruction;
            if (fmt) prompt += `\n\nOUTPUT INSTRUCTION: ${fmt}`;
            
            const content = activeDoc ? `DOCUMENT CONTENT (${activeDoc.name}):\n${activeDoc.content.substring(0, 30000)}\n\nUSER QUERY: ${userMsg.text}` : userMsg.text;
            
            const result = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: content, config: { systemInstruction: prompt } });
            setMessages(p => [...p, { id: crypto.randomUUID(), role: 'model', text: result.text, timestamp: Date.now(), format: selectedFormat }]);
        } catch (e: any) {
            setMessages(p => [...p, { id: crypto.randomUUID(), role: 'model', text: `Error: ${e.message}`, timestamp: Date.now(), isError: true }]);
        } finally { setIsLoading(false); }
    };

    const handleGenCommon = async (prompt: string, type: 'report' | 'table') => {
        setIsSidebarOpen(false);
        const apiKey = getApiKey();
        if (!apiKey) return;
        const userMsg: Message = { id: crypto.randomUUID(), role: 'user', text: prompt, timestamp: Date.now() };
        setMessages(p => [...p, userMsg]); setIsLoading(true); setShowWelcome(false); incrementStat('queries');
        
        try {
            const ai = new GoogleGenAI({ apiKey });
            const activeDoc = documents.find(d => d.id === activeDocId);
            const content = activeDoc ? `CONTEXT (Active Document - ${activeDoc.name}):\n${activeDoc.content.substring(0, 30000)}\n\n${prompt}` : prompt;
            const res = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: content, config: { systemInstruction: masterPrompt } });
            setMessages(p => [...p, { id: crypto.randomUUID(), role: 'model', text: res.text, timestamp: Date.now(), format: type }]);
        } catch (e) { console.error(e); } finally { setIsLoading(false); }
    };

    if (!currentUser) return <AuthScreen onLogin={handleLogin} />;

    return (
        <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden font-sans text-gray-900 dark:text-gray-100">
            {showAdminPanel && <AdminDashboard isOpen={showAdminPanel} onClose={() => setShowAdminPanel(false)} currentUser={currentUser} />}
            {showPricingModal && <PricingModal isOpen={showPricingModal} onClose={() => setShowPricingModal(false)} onUpgrade={handleUpgrade} currentPlan={currentUser.plan} />}
            {showRubricModal && <RubricGeneratorModal isOpen={showRubricModal} onClose={() => setShowRubricModal(false)} onGenerate={(c) => { setShowRubricModal(false); handleGenCommon(`Generate a ${c.scale}-point rubric for "${c.assignment}" (${c.gradeLevel}) focusing on ${c.bloomsLevel}.`, 'table'); }} activeDocName={documents.find(d => d.id === activeDocId)?.name || null} />}
            {showLessonModal && <LessonPlanModal isOpen={showLessonModal} onClose={() => setShowLessonModal(false)} onGenerate={(c) => { setShowLessonModal(false); handleGenCommon(`Generate a lesson plan for "${c.topic}" (${c.gradeLevel}) using ${c.templateId} model.`, 'report'); }} activeDocName={documents.find(d => d.id === activeDocId)?.name || null} />}
            {showAssessmentModal && <AssessmentGeneratorModal isOpen={showAssessmentModal} onClose={() => setShowAssessmentModal(false)} onGenerate={(c) => { setShowAssessmentModal(false); handleGenCommon(`Generate a ${c.count}-question ${c.type} assessment for "${c.topic}" (${c.gradeLevel}).`, 'report'); }} activeDocName={documents.find(d => d.id === activeDocId)?.name || null} />}

            <div className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} ${isSidebarCollapsed ? 'lg:w-20' : 'lg:w-80'} w-80 h-full`}>
                <div className="p-6 border-b border-gray-200 dark:border-gray-700 h-20 flex justify-between items-center">
                    <div className={`flex items-center gap-3 ${isSidebarCollapsed ? 'lg:hidden' : ''}`}><div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-indigo-600 flex items-center justify-center text-white font-bold">E</div><div><h1 className="text-xl font-bold dark:text-white">Edtech AI</h1></div></div>
                    <button onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)} className="hidden lg:block p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">{isSidebarCollapsed ? 'E' : <IconMenu />}</button>
                    <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 text-gray-500"><IconClose /></button>
                </div>
                
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-600 text-white flex items-center justify-center font-bold">{currentUser.name[0]}</div>
                        {!isSidebarCollapsed && <div className="flex-1 min-w-0"><p className="text-sm font-semibold truncate dark:text-white">{currentUser.name}</p><p className="text-xs text-gray-500 uppercase">{currentUser.plan}</p></div>}
                    </div>
                    {!isSidebarCollapsed && currentUser.plan === 'free' && <button onClick={() => setShowPricingModal(true)} className="mt-3 w-full py-1.5 text-xs font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 rounded-lg flex items-center justify-center gap-2"><IconStar /> Upgrade</button>}
                    {!isSidebarCollapsed && currentUser.role === 'admin' && <button onClick={() => setShowAdminPanel(true)} className="mt-2 w-full py-1.5 text-xs bg-gray-900 text-white rounded-lg flex items-center justify-center gap-2"><IconShield /> Admin</button>}
                </div>

                <div className="p-4 space-y-2 border-b border-gray-200 dark:border-gray-700">
                    {!isSidebarCollapsed && <h3 className="text-xs font-bold text-gray-400 uppercase">AI Tools</h3>}
                    <button onClick={() => setShowRubricModal(true)} className="w-full flex items-center gap-2 p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 text-sm font-medium"><IconTable /> {!isSidebarCollapsed && 'Rubric Generator'}</button>
                    <button onClick={() => setShowLessonModal(true)} className="w-full flex items-center gap-2 p-2 rounded-lg bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 text-sm font-medium"><IconClipboard /> {!isSidebarCollapsed && 'Lesson Planner'}</button>
                    <button onClick={() => setShowAssessmentModal(true)} className="w-full flex items-center gap-2 p-2 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 text-sm font-medium"><IconClipboardCheck /> {!isSidebarCollapsed && 'Assessment Gen'}</button>
                </div>

                <div className="p-4 flex-1 overflow-y-auto">
                    <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all">
                        <div className="flex flex-col items-center pt-2 pb-3">{isProcessingFile ? <div className="loader w-6 h-6 border-2 border-primary-600 rounded-full animate-spin"></div> : <IconUpload />}<p className="text-xs text-gray-500 mt-1">{!isSidebarCollapsed && (isProcessingFile ? 'Processing...' : 'Upload File')}</p></div>
                        <input type="file" className="hidden" onChange={handleFileUpload} disabled={isProcessingFile} />
                    </label>
                    {fileError && !isSidebarCollapsed && <p className="text-xs text-red-500 mt-2 text-center">{fileError}</p>}
                    
                    <div className="mt-6 space-y-2">
                        {!isSidebarCollapsed && <h3 className="text-xs font-bold text-gray-400 uppercase">Documents</h3>}
                        {documents.map(doc => (
                            <div key={doc.id} onClick={() => setActiveDocId(doc.id)} className={`flex items-center p-2 rounded-lg cursor-pointer ${activeDocId === doc.id ? 'bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                                <IconFile type={doc.type} />
                                {!isSidebarCollapsed && <div className="ml-3 flex-1 min-w-0"><p className={`text-sm font-medium truncate ${activeDocId === doc.id ? 'text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300'}`}>{doc.name}</p><p className="text-[10px] text-gray-400">{formatBytes(doc.size)}</p></div>}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                    <button onClick={handleLogout} className="flex items-center justify-center w-full gap-2 p-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><IconLogout /> {!isSidebarCollapsed && 'Sign Out'}</button>
                </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0 relative h-full">
                <header className="h-16 border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-20">
                    <div className="flex items-center gap-3">
                        <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2"><IconMenu /></button>
                        <div className="text-sm breadcrumbs text-gray-500"><span className="font-medium text-gray-900 dark:text-white">Workspace</span> <span className="mx-2">/</span> <span className="text-primary-600 font-medium">{activeDocId ? documents.find(d => d.id === activeDocId)?.name : 'General Chat'}</span></div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">{isDarkMode ? <IconSun /> : <IconMoon />}</button>
                        {currentUser.role === 'admin' && <button onClick={() => setShowSettings(!showSettings)} className={`p-2 rounded-lg flex items-center gap-2 ${showSettings ? 'bg-green-100 text-green-700' : 'text-gray-500 hover:bg-gray-100'}`}><IconCpu /><span className="hidden sm:inline text-xs font-bold">Neural Core</span></button>}
                    </div>
                </header>

                {showSettings && currentUser.role === 'admin' && (
                    <div className="absolute top-16 left-0 right-0 z-30 bg-gray-900 border-b border-gray-700 p-6 text-green-500 font-mono shadow-2xl animate-slideDown">
                        <div className="max-w-5xl mx-auto grid grid-cols-3 gap-8">
                            <div className="col-span-2">
                                <h3 className="font-bold mb-2 flex items-center gap-2"><IconCpu /> SYSTEM PROMPT CONFIGURATION</h3>
                                <textarea value={masterPrompt} onChange={e => setMasterPrompt(e.target.value)} readOnly={!isCoreUnlocked} className={`w-full h-64 bg-black/50 p-4 border rounded-lg resize-none focus:outline-none ${isCoreUnlocked ? 'border-green-500 text-green-400' : 'border-gray-700 text-gray-500'}`} />
                            </div>
                            <div className="space-y-4">
                                <div className="p-4 border border-green-900/50 bg-green-900/10 rounded"><p className="text-xs uppercase font-bold mb-2">Directives</p><ul className="text-xs list-disc pl-4 space-y-1"><li>Overrides default behavior</li><li>Persists locally</li><li>Applies to all generators</li></ul></div>
                                <button onClick={() => setIsCoreUnlocked(!isCoreUnlocked)} className="w-full py-2 border border-green-500 text-green-500 hover:bg-green-500 hover:text-black font-bold uppercase text-xs rounded transition-all">{isCoreUnlocked ? 'Lock Core' : 'Unlock Core'}</button>
                                {isCoreUnlocked && <button onClick={() => { localStorage.setItem(STORAGE_KEYS.PROMPT, masterPrompt); setIsCoreUnlocked(false); }} className="w-full py-2 bg-green-600 text-black font-bold uppercase text-xs rounded hover:bg-green-500">Save Changes</button>}
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth" id="chat-container">
                    <div className="max-w-4xl mx-auto space-y-6 pb-4">
                        {showWelcome && (
                            <div className="flex flex-col items-center justify-center py-20 text-center animate-fadeIn">
                                <div className="w-20 h-20 bg-primary-100 rounded-3xl flex items-center justify-center mb-6 text-primary-600 shadow-xl"><IconBot /></div>
                                <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">How can I help you today?</h2>
                                <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-8">Upload a lesson plan, rubric, or document to the left, or just ask me anything about pedagogy.</p>
                                <div className="grid grid-cols-2 gap-4 w-full max-w-xl">
                                    {['Create a 5E Lesson Plan', 'Generate Bloom\'s Questions', 'Draft a Rubric', 'Summarize this doc'].map(hint => (
                                        <button key={hint} onClick={() => setInput(hint)} className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:shadow-md text-sm font-medium text-gray-600 dark:text-gray-300 transition-all text-left">{hint} →</button>
                                    ))}
                                </div>
                            </div>
                        )}
                        {messages.map(msg => (
                            <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-slideUp`}>
                                {msg.role === 'model' && <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-indigo-600 flex items-center justify-center flex-shrink-0 mt-1 shadow-md text-white text-xs font-bold">AI</div>}
                                <div className={`max-w-[90%] rounded-2xl p-5 shadow-sm ${msg.role === 'user' ? 'bg-primary-600 text-white rounded-tr-sm' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-tl-sm text-gray-800 dark:text-gray-100'} ${msg.isError ? 'bg-red-50 border-red-500 dark:bg-red-900/20' : ''}`}>
                                    {msg.role === 'user' ? <p className="whitespace-pre-wrap">{msg.text}</p> : <MarkdownContent content={msg.text} />}
                                    {msg.role === 'model' && !msg.isError && (
                                        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/50">
                                            <button onClick={() => navigator.clipboard.writeText(msg.text)} className="text-xs flex items-center gap-1 text-gray-400 hover:text-primary-500"><IconCopy /> Copy</button>
                                            <span className="text-gray-300">|</span>
                                            <button onClick={() => { const d = new window.jspdf.jsPDF(); d.text(d.splitTextToSize(msg.text, 180), 10, 10); d.save('export.pdf'); }} className="text-xs font-bold text-red-400 hover:text-red-500">PDF</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {isLoading && <div className="flex gap-4"><div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse"></div><div className="p-4 bg-white dark:bg-gray-800 rounded-2xl shadow-sm border dark:border-gray-700 flex gap-1"><div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce"></div><div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce delay-75"></div><div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce delay-150"></div></div></div>}
                        <div ref={messagesEndRef} />
                    </div>
                </div>

                <div className="p-4 bg-white/90 dark:bg-gray-900/90 backdrop-blur-lg border-t border-gray-200 dark:border-gray-700 z-20">
                    <div className="max-w-4xl mx-auto">
                        <div className="flex gap-2 mb-2 overflow-x-auto pb-1 scrollbar-hide">
                            {FORMAT_OPTIONS.map(opt => (
                                <button key={opt.id} onClick={() => setSelectedFormat(opt.id)} className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1 ${selectedFormat === opt.id ? 'bg-primary-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200'}`}>{selectedFormat === opt.id && <IconFormat />}{opt.label}</button>
                            ))}
                        </div>
                        <div className="relative flex items-end gap-2 bg-gray-50 dark:bg-gray-800 p-2 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm focus-within:ring-2 focus-within:ring-primary-500 transition-all">
                            <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}} placeholder="Type a message..." className="w-full bg-transparent border-none focus:ring-0 resize-none py-3 px-3 text-sm dark:text-white max-h-32" rows={1} />
                            <button onClick={handleSend} disabled={!input.trim() || isLoading} className="p-3 bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-50 shadow-md transition-all mb-0.5"><IconSend /></button>
                        </div>
                        <p className="text-center text-[10px] text-gray-400 mt-2">AI can make mistakes. Verify important information.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);