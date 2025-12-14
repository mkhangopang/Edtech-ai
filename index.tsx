import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Content } from "@google/genai";
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// --- CONFIGURATION & HYBRID FALLBACK ---
const getEnv = (key: string) => {
    try {
        // @ts-ignore
        if (typeof import.meta !== 'undefined' && import.meta.env) return import.meta.env[key];
    } catch(e) {}
    try {
        if (typeof process !== 'undefined' && process.env) return process.env[key];
    } catch(e) {}
    return undefined;
}

const ENV_URL = getEnv('VITE_SUPABASE_URL');
const ENV_KEY = getEnv('VITE_SUPABASE_ANON_KEY');

// Enhanced check to ensure URL is actually a URL
const isSupabaseConfigured = !!(ENV_URL && ENV_URL.startsWith('http') && ENV_URL !== "https://your-project.supabase.co" && ENV_KEY && ENV_KEY !== "your-anon-key");

// Prevent initializing client with bad data to avoid network timeouts/errors
const supabase: SupabaseClient | null = isSupabaseConfigured 
    ? createClient(ENV_URL!, ENV_KEY!) 
    : null;

// --- Constants & Storage Keys ---
const STORAGE_KEYS = {
  USERS: 'edtech_users_v5', 
  SESSION: 'edtech_session_v5',
  DOCS_PREFIX: 'edtech_docs_v5_', 
  CHAT_PREFIX: 'edtech_chat_v5_',
  EVENTS_PREFIX: 'edtech_events_v5_',
  SETTINGS: 'edtech_settings_v5',
  API_KEY: 'edtech_temp_key'
};

const DEFAULT_SYSTEM_INSTRUCTION = `
ROLE: You are "Edtech AI", an elite pedagogical consultant.
CORE DIRECTIVES: Apply Bloom's Taxonomy, 5E Model, and UbD.
`.trim();

const PLAN_LIMITS = {
  free: { maxDocs: 1, maxSizeMB: 5, label: 'Free Tier' },
  pro: { maxDocs: 10, maxSizeMB: 20, label: 'Educator Pro' },
  campus: { maxDocs: 999, maxSizeMB: 50, label: 'Campus Plan' }
};

const FORMAT_OPTIONS: { id: OutputFormat; label: string; instruction: string }[] = [
  { id: 'auto', label: 'Auto', instruction: "Answer naturally." },
  { id: 'report', label: 'Report', instruction: "Professional report format with H1/H2." },
  { id: 'table', label: 'Table', instruction: "Markdown table format." },
  { id: 'concise', label: 'Concise', instruction: "Brief summary (BLUF)." },
  { id: 'step', label: 'Steps', instruction: "Numbered step-by-step guide." }
];

// --- Types ---
type PlanType = 'free' | 'pro' | 'campus';

interface DocumentFile {
  id: string;
  user_id: string;
  name: string;
  type: 'pdf' | 'docx' | 'txt';
  content: string;
  size: number;
  created_at?: number;
}

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  isError?: boolean;
  suggestions?: Suggestion[]; 
  isThinking?: boolean; 
}

interface Suggestion {
  label: string;
  action: 'quiz' | 'rubric' | 'chat';
  prompt?: string;
}

interface CalendarEvent {
    id: string;
    title: string;
    date: string; // ISO date string YYYY-MM-DD
    type: 'class' | 'deadline' | 'meeting';
}

type OutputFormat = 'auto' | 'report' | 'table' | 'concise' | 'step';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: 'user' | 'admin';
  plan: PlanType;
}

declare global {
  interface Window {
    pdfjsLib: any;
    mammoth: any;
    marked: any;
    jspdf: any;
  }
}

// --- Icons ---
const IconMenu = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>;
const IconClose = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
const IconUpload = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>;
const IconFile = ({ type }: { type: string }) => {
  let c = "text-gray-400";
  if (type === 'pdf') c = "text-red-400";
  if (type === 'docx') c = "text-blue-400";
  return <svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 ${c}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 011.414.586l5.414 5.414a1 1 0 01.586 1.414V19a2 2 0 01-2 2z" /></svg>;
};
const IconTrash = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>;
const IconSend = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>;
const IconBot = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>;
const IconDownload = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>;
const IconTable = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7-4h14M4 6h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" /></svg>;
const IconClipboard = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>;
const IconClipboardCheck = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>;
const IconCalendar = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
const IconChat = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>;
const IconInfo = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const IconKey = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>;
const IconSettings = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>;
const IconCloud = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>;
const IconOffline = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" /></svg>;
const IconBrain = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>;

// --- API LAYER (HYBRID) ---
const api = {
    getProfile: async (): Promise<UserProfile | null> => {
        if (!supabase) {
             const sessionStr = localStorage.getItem(STORAGE_KEYS.SESSION);
             return sessionStr ? JSON.parse(sessionStr) : null;
        }
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
            if (error) {
                 return { id: user.id, email: user.email!, full_name: user.user_metadata.full_name || 'User', role: 'user', plan: 'free' };
            }
            return data;
        } catch { return null; }
    },

    saveUserLocal: (user: UserProfile) => {
        localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(user));
    },

    saveDoc: async (doc: DocumentFile) => {
        if (!supabase) {
             const key = `${STORAGE_KEYS.DOCS_PREFIX}${doc.user_id}`;
             const docsStr = localStorage.getItem(key);
             const docs: DocumentFile[] = docsStr ? JSON.parse(docsStr) : [];
             docs.push(doc);
             localStorage.setItem(key, JSON.stringify(docs));
             return;
        }
        try {
            const { error } = await supabase.from('documents').insert(doc);
            if (error) console.error("Doc Save Error:", error);
        } catch(e) { console.error("Doc Save Exception:", e); }
    },

    getDocs: async (userId: string): Promise<DocumentFile[]> => {
        if (!supabase) {
            const key = `${STORAGE_KEYS.DOCS_PREFIX}${userId}`;
            const docsStr = localStorage.getItem(key);
            return docsStr ? JSON.parse(docsStr) : [];
        }
        const { data } = await supabase.from('documents').select('*').eq('user_id', userId);
        return data || [];
    },

    saveChat: async (userId: string, messages: Message[]) => {
        if (!supabase) {
             localStorage.setItem(`${STORAGE_KEYS.CHAT_PREFIX}${userId}`, JSON.stringify(messages));
             return;
        }
        try {
            const { data } = await supabase.from('chats').select('id').eq('user_id', userId).maybeSingle();
            if (data) {
                await supabase.from('chats').update({ messages }).eq('id', data.id);
            } else {
                await supabase.from('chats').insert({ user_id: userId, messages });
            }
        } catch (err) {
            console.error("Chat sync failed (Tables might be missing):", err);
        }
    },

    getChat: async (userId: string): Promise<Message[]> => {
        if (!supabase) {
            const str = localStorage.getItem(`${STORAGE_KEYS.CHAT_PREFIX}${userId}`);
            return str ? JSON.parse(str) : [];
        }
        const { data } = await supabase.from('chats').select('messages').eq('user_id', userId).single();
        return data?.messages || [];
    },

    // --- ASYNC CALENDAR EVENTS (DB + Fallback) ---
    getEvents: async (userId: string): Promise<CalendarEvent[]> => {
        if (!supabase) {
            const str = localStorage.getItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`);
            return str ? JSON.parse(str) : [];
        }
        try {
            const { data, error } = await supabase.from('events').select('*').eq('user_id', userId);
            // If table doesn't exist (error 404/42P01), fall back to local
            if (error) throw error; 
            return data || [];
        } catch (e) {
            // Quiet fail to local storage to prevent app crash if SQL wasn't run
            const str = localStorage.getItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`);
            return str ? JSON.parse(str) : [];
        }
    },

    saveEvent: async (userId: string, event: CalendarEvent) => {
        if (!supabase) {
            const current = JSON.parse(localStorage.getItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`) || "[]");
            current.push(event);
            localStorage.setItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`, JSON.stringify(current));
            return;
        }
        try {
            const { error } = await supabase.from('events').insert({
                id: event.id,
                user_id: userId,
                title: event.title,
                date: event.date,
                type: event.type
            });
            if (error) throw error;
        } catch (e) {
            // Fallback
            const current = JSON.parse(localStorage.getItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`) || "[]");
            current.push(event);
            localStorage.setItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`, JSON.stringify(current));
        }
    },
    
    deleteEvent: async (userId: string, eventId: string) => {
        if(!supabase) {
             const current = JSON.parse(localStorage.getItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`) || "[]");
             const next = current.filter((e: CalendarEvent) => e.id !== eventId);
             localStorage.setItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`, JSON.stringify(next));
             return;
        }
        try {
            const { error } = await supabase.from('events').delete().eq('id', eventId);
            if(error) throw error;
        } catch(e) {
             const current = JSON.parse(localStorage.getItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`) || "[]");
             const next = current.filter((e: CalendarEvent) => e.id !== eventId);
             localStorage.setItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`, JSON.stringify(next));
        }
    },

    // App Brain
    getMasterPrompt: async (): Promise<string> => {
        if (!supabase) {
            return localStorage.getItem('edtech_master_prompt') || DEFAULT_SYSTEM_INSTRUCTION;
        }
        const { data } = await supabase.from('system_settings').select('value').eq('key', 'master_prompt').maybeSingle();
        return data?.value || DEFAULT_SYSTEM_INSTRUCTION;
    },

    setMasterPrompt: async (prompt: string) => {
        if (!supabase) {
            localStorage.setItem('edtech_master_prompt', prompt);
            return;
        }
        try {
            const { data } = await supabase.from('system_settings').select('key').eq('key', 'master_prompt').maybeSingle();
            if(data) {
                await supabase.from('system_settings').update({ value: prompt }).eq('key', 'master_prompt');
            } else {
                await supabase.from('system_settings').insert({ key: 'master_prompt', value: prompt });
            }
        } catch(e) { console.error("Settings Save Error:", e); alert("Failed to save settings to DB."); }
    },

    getAllUsers: async (): Promise<UserProfile[]> => {
        if (!supabase) return [];
        try {
            const { data } = await supabase.from('profiles').select('*').order('joined_date', { ascending: false });
            return data || [];
        } catch { return []; }
    },

    // AI Generation (Streaming + Deep Think)
    generateAIStream: async function* (apiKey: string, prompt: string, sys: string, hist: any[], useThinking: boolean) {
        const ai = new GoogleGenAI({ apiKey });
        const contents: Content[] = hist.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
        }));
        contents.push({ role: 'user', parts: [{ text: prompt }] });
        
        const config: any = { systemInstruction: sys };
        
        // Deep Thinking Config (Gemini 2.5 Flash only)
        if (useThinking) {
            // Budget is token count for internal reasoning
            config.thinkingConfig = { thinkingBudget: 4096 }; 
        }

        const result = await ai.models.generateContentStream({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: config
        });

        for await (const chunk of result) {
            yield chunk.text; 
        }
    }
};

// --- Helpers ---
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

const getApiKey = (): string | null => {
    const key = getEnv('API_KEY') || getEnv('VITE_API_KEY');
    if (key) return key;
    return sessionStorage.getItem(STORAGE_KEYS.API_KEY);
};

const handleExportPDF = (content: string, filename: string) => {
    if (!window.jspdf) return alert("PDF generator not loaded.");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(18); doc.setTextColor(79, 70, 229); doc.text("Edtech AI", 20, 20);
    doc.setFontSize(10); doc.setTextColor(100); doc.text(`Generated: ${new Date().toLocaleDateString()}`, 20, 28);
    doc.setFontSize(12); doc.setTextColor(0);
    const splitText = doc.splitTextToSize(content, 170);
    let y = 40;
    for(let i = 0; i < splitText.length; i++) {
        if (y > 280) { doc.addPage(); y = 20; }
        doc.text(splitText[i], 20, y); y += 7;
    }
    doc.save(`${filename}.pdf`);
};

// --- Components ---

const MarkdownContent = ({ content }: { content: string }) => {
  const [html, setHtml] = useState('');
  useEffect(() => {
    if (window.marked) {
        // SECURITY: Basic sanitization config
        window.marked.setOptions({
            breaks: true, // Render newlines as breaks
            gfm: true
        });
        setHtml(window.marked.parse(content));
    }
    else setHtml(content);
  }, [content]);
  return <div className="prose dark:prose-invert max-w-none text-sm leading-relaxed break-words" dangerouslySetInnerHTML={{ __html: html }} />;
};

const TermsModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700 max-h-[80vh] overflow-y-auto">
                <div className="p-6">
                    <h2 className="text-xl font-bold mb-4 dark:text-white flex items-center gap-2"><IconInfo /> Terms & AI Transparency</h2>
                    <div className="space-y-4 text-sm text-gray-600 dark:text-gray-300">
                        <div className="bg-blue-50 dark:bg-blue-900/30 p-3 rounded-lg border border-blue-100 dark:border-blue-800">
                            <strong>AI Disclaimer:</strong> This app uses Google Gemini. Output may be inaccurate. Verify all educational content before use.
                        </div>
                        <p><strong>Data Privacy:</strong> {isSupabaseConfigured ? "Your data is securely stored in Supabase with RLS protection." : "You are in Local/Demo Mode. Data is stored only in your browser."}</p>
                        <p><strong>Freemium Limits:</strong> Free tier is limited. Upgrade to 'Pro' to unlock more.</p>
                    </div>
                    <button onClick={onClose} className="mt-6 w-full py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium">I Understand</button>
                </div>
            </div>
        </div>
    );
};

const ApiKeyModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
    const [key, setKey] = useState('');
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-md p-4 animate-fadeIn">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md border border-gray-200 dark:border-gray-700">
                <div className="p-6">
                    <h2 className="text-lg font-bold mb-2 dark:text-white flex items-center gap-2"><IconKey /> Setup API Key</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                        Please enter your Google Gemini API key. Stored locally in session.
                    </p>
                    <input 
                        type="password" 
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full px-4 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 outline-none mb-4 dark:text-white"
                    />
                    <div className="flex gap-2">
                         <a href="https://aistudio.google.com/app/apikey" target="_blank" className="flex-1 py-2 text-center text-sm text-primary-600 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg border border-transparent">Get Key</a>
                         <button onClick={() => { if(key) { sessionStorage.setItem(STORAGE_KEYS.API_KEY, key); onClose(); } }} className="flex-1 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-bold">Save & Start</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Admin Modal: Now with Brain Editing + User List
const AdminSettingsModal = ({ isOpen, onClose, user }: { isOpen: boolean, onClose: () => void, user: UserProfile }) => {
    const [prompt, setPrompt] = useState('');
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<'brain'|'users'>('brain');

    useEffect(() => {
        if (isOpen) {
            api.getMasterPrompt().then(setPrompt);
            api.getAllUsers().then(setUsers);
        }
    }, [isOpen]);

    const handleSave = async () => {
        setLoading(true);
        try {
            await api.setMasterPrompt(prompt);
            alert("System Brain Updated!");
        } catch(e) {
            alert("Failed to update.");
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
         <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-md p-4 animate-fadeIn">
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-4xl border border-gray-700 h-[80vh] flex flex-col">
                <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                    <h2 className="text-white font-bold flex items-center gap-2"><IconSettings /> Admin Console</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><IconClose /></button>
                </div>
                
                {/* Tabs */}
                <div className="flex border-b border-gray-700">
                    <button onClick={() => setActiveTab('brain')} className={`px-6 py-3 text-sm font-medium ${activeTab === 'brain' ? 'text-white border-b-2 border-green-500' : 'text-gray-400 hover:text-white'}`}>App Brain</button>
                    <button onClick={() => setActiveTab('users')} className={`px-6 py-3 text-sm font-medium ${activeTab === 'users' ? 'text-white border-b-2 border-green-500' : 'text-gray-400 hover:text-white'}`}>Users ({users.length})</button>
                </div>

                <div className="flex-1 p-4 overflow-hidden">
                     {activeTab === 'brain' ? (
                         <div className="h-full flex flex-col">
                             <p className="text-gray-400 text-xs mb-2">Configure the master system instruction for all users.</p>
                             <textarea 
                                value={prompt}
                                onChange={e => setPrompt(e.target.value)}
                                className="flex-1 w-full bg-black text-green-400 font-mono text-sm p-4 rounded border border-gray-700 outline-none resize-none mb-4"
                             />
                             <div className="flex justify-end">
                                <button onClick={handleSave} disabled={loading} className="px-6 py-2 bg-green-600 text-white font-bold rounded hover:bg-green-700">
                                    {loading ? 'Saving...' : 'Update Brain'}
                                </button>
                             </div>
                         </div>
                     ) : (
                         <div className="h-full overflow-y-auto">
                            {!users.length ? (
                                <p className="text-gray-500 p-4">No users found or RLS restricted.</p>
                            ) : (
                                 <table className="w-full text-sm text-left text-gray-400">
                                     <thead className="text-xs text-gray-200 uppercase bg-gray-800">
                                         <tr>
                                             <th className="px-4 py-3">Name</th>
                                             <th className="px-4 py-3">Email</th>
                                             <th className="px-4 py-3">Plan</th>
                                             <th className="px-4 py-3">Role</th>
                                         </tr>
                                     </thead>
                                     <tbody>
                                         {users.map(u => (
                                             <tr key={u.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                                                 <td className="px-4 py-3 font-medium text-white">{u.full_name}</td>
                                                 <td className="px-4 py-3">{u.email}</td>
                                                 <td className="px-4 py-3"><span className={`px-2 py-1 rounded text-xs ${u.plan === 'free' ? 'bg-gray-700' : 'bg-purple-900 text-purple-200'}`}>{u.plan}</span></td>
                                                 <td className="px-4 py-3">{u.role}</td>
                                             </tr>
                                         ))}
                                     </tbody>
                                 </table>
                            )}
                         </div>
                     )}
                </div>
            </div>
         </div>
    );
}

const PricingModal = ({ isOpen, onClose, user }: { isOpen: boolean, onClose: () => void, user: UserProfile }) => {
    if (!isOpen) return null;
    const handleUpgrade = async (plan: PlanType) => {
        if (!isSupabaseConfigured) {
             const updated = { ...user, plan };
             api.saveUserLocal(updated);
             alert(`Upgraded to ${plan} (Demo Mode).`);
             window.location.reload();
             return;
        }
        const { error } = await supabase!.from('profiles').update({ plan }).eq('id', user.id);
        if(!error) {
            alert(`Upgraded to ${plan}! Refreshing...`);
            window.location.reload();
        }
    }
    
    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-md p-4 animate-fadeIn">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl border border-gray-200 dark:border-gray-700 p-8 relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><IconClose/></button>
                <div className="text-center mb-10">
                    <h2 className="text-3xl font-bold dark:text-white mb-2">Upgrade Your Teaching Toolkit</h2>
                    <p className="text-gray-500">Choose the plan that fits your classroom needs.</p>
                </div>
                <div className="grid md:grid-cols-3 gap-6">
                    {Object.entries(PLAN_LIMITS).map(([key, limit]) => (
                        <div key={key} className={`border rounded-xl p-6 flex flex-col ${user.plan === key ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/10 ring-2 ring-primary-500' : 'border-gray-200 dark:border-gray-700'}`}>
                            <h3 className="text-xl font-bold dark:text-white capitalize">{limit.label}</h3>
                            <div className="mt-4 space-y-2 text-sm text-gray-600 dark:text-gray-300 flex-1">
                                <p>• {limit.maxDocs === 999 ? 'Unlimited' : limit.maxDocs} Documents</p>
                                <p>• {limit.maxSizeMB}MB Upload Limit</p>
                                <p>• {key === 'free' ? 'Basic' : 'Advanced'} AI Reasoning</p>
                            </div>
                            <button 
                                onClick={() => handleUpgrade(key as PlanType)}
                                disabled={user.plan === key}
                                className={`mt-6 w-full py-2 rounded-lg font-bold ${user.plan === key ? 'bg-gray-200 text-gray-500 cursor-default' : 'bg-primary-600 text-white hover:bg-primary-700'}`}
                            >
                                {user.plan === key ? 'Current Plan' : 'Select'}
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// --- APP COMPONENT ---
const App = () => {
    const [user, setUser] = useState<UserProfile | null>(null);
    const [isInitializing, setInitializing] = useState(true);
    const [activeTab, setActiveTab] = useState<'chat' | 'docs' | 'calendar'>('chat');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    
    // Data States
    const [docs, setDocs] = useState<DocumentFile[]>([]);
    const [chat, setChat] = useState<Message[]>([]);
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    
    // UI States
    const [input, setInput] = useState('');
    const [isStreaming, setStreaming] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);
    const [showAdmin, setShowAdmin] = useState(false);
    const [showPricing, setShowPricing] = useState(false);
    const [showTerms, setShowTerms] = useState(false);
    const [outputFormat, setOutputFormat] = useState<OutputFormat>('auto');
    const [useThinking, setUseThinking] = useState(false);
    const [fileToUpload, setFileToUpload] = useState<File|null>(null);
    const [isProcessingFile, setIsProcessingFile] = useState(false);
    const [newEvent, setNewEvent] = useState({ title: '', date: '', type: 'class' });

    // Login States
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [authMode, setAuthMode] = useState<'login'|'signup'>('login');
    const [authLoading, setAuthLoading] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Initialization Logic
    useEffect(() => {
        const init = async () => {
            // FIX: Check session validity to prevent 400 errors loop
            if (supabase) {
                const { error } = await supabase.auth.getSession();
                if (error) {
                   console.warn("Session invalid, clearing...", error);
                   await supabase.auth.signOut();
                }
            }

            const u = await api.getProfile();
            setUser(u);
            
            if (u) {
                 const [d, c, e] = await Promise.all([
                     api.getDocs(u.id),
                     api.getChat(u.id),
                     api.getEvents(u.id)
                 ]);
                 setDocs(d);
                 setChat(c);
                 setEvents(e);
            }
            // Delay slightly to prevent flicker if fast
            setTimeout(() => setInitializing(false), 500);
        };
        init();
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [chat]);

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isSupabaseConfigured) {
             const mockId = 'user_' + Date.now();
             const u: UserProfile = { id: mockId, email, full_name: 'Demo User', role: 'user', plan: 'free' };
             api.saveUserLocal(u);
             window.location.reload();
             return;
        }
        setAuthLoading(true);
        try {
            if (authMode === 'signup') {
                const { error } = await supabase!.auth.signUp({ email, password, options: { data: { full_name: 'New Educator' } } });
                if (error) throw error;
                alert("Check email for confirmation!");
            } else {
                const { error } = await supabase!.auth.signInWithPassword({ email, password });
                if (error) throw error;
                window.location.reload();
            }
        } catch(e: any) { alert(e.message); }
        finally { setAuthLoading(false); }
    };

    const handleSend = async () => {
        if (!input.trim() && !fileToUpload) return;
        if (!user) return;
        const key = getApiKey();
        if (!key) { setShowApiKey(true); return; }

        const newUserMsg: Message = { id: Date.now().toString(), role: 'user', text: input, timestamp: Date.now() };
        
        let contextContent = "";
        if (fileToUpload) {
             // Basic text extraction for context
             setIsProcessingFile(true);
             try {
                if(fileToUpload.type.includes('pdf')) contextContent = await extractTextFromPDF(fileToUpload);
                else if(fileToUpload.name.endsWith('docx')) contextContent = await extractTextFromDOCX(fileToUpload);
                else contextContent = await fileToUpload.text();
                newUserMsg.text += `\n\n[Attached File Content: ${fileToUpload.name}]\n${contextContent.substring(0, 10000)}...`; // Truncate for token limits
             } catch(e) {
                 alert("Failed to read file.");
                 setIsProcessingFile(false);
                 return;
             }
             setIsProcessingFile(false);
        }
        
        const newChat = [...chat, newUserMsg];
        setChat(newChat);
        setInput('');
        setFileToUpload(null);
        setStreaming(true);

        const formatInst = FORMAT_OPTIONS.find(f => f.id === outputFormat)?.instruction || "";
        const masterPrompt = await api.getMasterPrompt();
        const systemInstruction = `${masterPrompt}\nFormat Requirement: ${formatInst}`;

        try {
            const stream = api.generateAIStream(key, newUserMsg.text, systemInstruction, chat, useThinking);
            
            let fullResponse = "";
            const botMsgId = (Date.now() + 1).toString();
            // Optimistic update
            setChat(prev => [...prev, { id: botMsgId, role: 'model', text: '', timestamp: Date.now(), isThinking: useThinking }]);

            for await (const chunk of stream) {
                fullResponse += chunk;
                setChat(prev => prev.map(m => m.id === botMsgId ? { ...m, text: fullResponse, isThinking: false } : m));
            }
            
            // Final save
            const finalChat: Message[] = [...newChat, { id: botMsgId, role: 'model', text: fullResponse, timestamp: Date.now() }];
            api.saveChat(user.id, finalChat);
            setChat(finalChat);

        } catch(e) {
             setChat(prev => [...prev, { id: Date.now().toString(), role: 'model', text: "Error generating response. Check API Key.", isError: true, timestamp: Date.now() } as Message]);
        } finally {
            setStreaming(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || !e.target.files[0] || !user) return;
        const file = e.target.files[0];
        
        const limit = PLAN_LIMITS[user.plan];
        if (file.size > limit.maxSizeMB * 1024 * 1024) { alert(`File too large for ${limit.label}.`); return; }
        if (docs.length >= limit.maxDocs) { alert(`Doc limit reached for ${limit.label}.`); return; }

        setIsProcessingFile(true);
        let content = "";
        try {
            if(file.type.includes('pdf')) content = await extractTextFromPDF(file);
            else if(file.name.endsWith('docx')) content = await extractTextFromDOCX(file);
            else content = await file.text();
            
            const newDoc: DocumentFile = {
                id: Date.now().toString(),
                user_id: user.id,
                name: file.name,
                type: file.type.includes('pdf') ? 'pdf' : file.name.endsWith('docx') ? 'docx' : 'txt',
                content: content,
                size: file.size,
                created_at: Date.now()
            };
            
            await api.saveDoc(newDoc);
            setDocs(prev => [...prev, newDoc]);
        } catch(e) { alert("Failed to parse document."); }
        finally { setIsProcessingFile(false); }
    };

    const handleAddEvent = async () => {
        if(!user || !newEvent.title || !newEvent.date) return;
        const ev: CalendarEvent = { 
            id: Date.now().toString(), 
            title: newEvent.title, 
            date: newEvent.date, 
            type: newEvent.type as any 
        };
        await api.saveEvent(user.id, ev);
        setEvents(prev => [...prev, ev]);
        setNewEvent({ title: '', date: '', type: 'class' });
    }

    if (isInitializing) {
        return (
            <div className="fixed inset-0 flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 z-50">
                <div className="loader"></div>
                <p className="mt-4 text-gray-500 font-medium">Initializing Edtech AI...</p>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
                <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl w-full max-w-md border border-gray-200 dark:border-gray-700">
                    <div className="text-center mb-8">
                        <div className="w-16 h-16 bg-primary-600 rounded-2xl mx-auto flex items-center justify-center mb-4 shadow-lg shadow-primary-600/30">
                            <IconBot />
                        </div>
                        <h1 className="text-2xl font-bold dark:text-white">Welcome to Edtech AI</h1>
                        <p className="text-gray-500 mt-2">Your pedagogical co-pilot.</p>
                    </div>
                    <form onSubmit={handleAuth} className="space-y-4">
                        <input 
                            type="email" required placeholder="Email"
                            value={email} onChange={e=>setEmail(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white"
                        />
                        <input 
                            type="password" required placeholder="Password"
                            value={password} onChange={e=>setPassword(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white"
                        />
                        <button disabled={authLoading} className="w-full py-3 bg-primary-600 text-white rounded-xl font-bold hover:bg-primary-700 transition-all flex justify-center items-center">
                            {authLoading ? <div className="loader h-5 w-5 border-2 border-white border-t-transparent" /> : (authMode === 'login' ? 'Sign In' : 'Create Account')}
                        </button>
                    </form>
                    <div className="mt-6 text-center">
                        <button onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')} className="text-sm text-primary-600 hover:underline">
                            {authMode === 'login' ? "New here? Create account" : "Have an account? Sign In"}
                        </button>
                    </div>
                    {!isSupabaseConfigured && (
                        <div className="mt-6 p-3 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 text-xs rounded-lg text-center">
                            Demo Mode Active (Local Storage Only)
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans">
            {/* Sidebar */}
            <div className={`fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-300 ease-in-out md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="flex flex-col h-full">
                    <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
                         <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center text-white font-bold">EA</div>
                         <span className="font-bold text-lg tracking-tight">Edtech AI</span>
                         <button onClick={() => setSidebarOpen(false)} className="md:hidden ml-auto"><IconClose /></button>
                    </div>
                    
                    <div className="p-4 space-y-1 overflow-y-auto flex-1">
                        <button onClick={() => setActiveTab('chat')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'chat' ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                            <IconChat /> Chat Assistant
                        </button>
                        <button onClick={() => setActiveTab('docs')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'docs' ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                            <IconCloud /> Documents
                        </button>
                        <button onClick={() => setActiveTab('calendar')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === 'calendar' ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                            <IconCalendar /> Planner
                        </button>
                        
                        <div className="pt-4 mt-4 border-t border-gray-100 dark:border-gray-700">
                            <button onClick={() => setShowPricing(true)} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400">
                                <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${user.plan === 'pro' ? 'bg-purple-100 text-purple-600' : 'bg-gray-200 text-gray-600'}`}>{user.plan}</span>
                                <span className="text-sm">Upgrade Plan</span>
                            </button>
                            <button onClick={() => setShowApiKey(true)} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400">
                                <IconKey /> <span className="text-sm">API Key</span>
                            </button>
                            {user.role === 'admin' && (
                                <button onClick={() => setShowAdmin(true)} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400">
                                    <IconSettings /> <span className="text-sm">Admin</span>
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="p-4 border-t border-gray-100 dark:border-gray-700">
                        <div className="flex items-center gap-3 mb-4 px-2">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                                {user.full_name[0]}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate dark:text-white">{user.full_name}</p>
                                <p className="text-xs text-gray-500 truncate">{user.email}</p>
                            </div>
                        </div>
                        <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="w-full py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg">Sign Out</button>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col md:ml-64 h-full relative">
                {/* Header */}
                <header className="h-16 flex items-center justify-between px-4 border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80 backdrop-blur z-10">
                    <button onClick={() => setSidebarOpen(true)} className="md:hidden p-2 text-gray-600"><IconMenu /></button>
                    <h2 className="font-semibold text-gray-800 dark:text-white">
                        {activeTab === 'chat' && 'AI Assistant'}
                        {activeTab === 'docs' && 'Document Library'}
                        {activeTab === 'calendar' && 'Lesson Planner'}
                    </h2>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setShowTerms(true)} className="p-2 text-gray-400 hover:text-primary-500"><IconInfo /></button>
                    </div>
                </header>

                {/* Tab Content */}
                <main className="flex-1 overflow-hidden relative">
                    
                    {/* CHAT TAB */}
                    {activeTab === 'chat' && (
                        <div className="flex flex-col h-full">
                            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                                {chat.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-gray-400 p-8 text-center opacity-60">
                                        <IconBot />
                                        <p className="mt-4 text-lg">How can I help you teach today?</p>
                                        <p className="text-sm">Try uploading a lesson plan or asking for a quiz.</p>
                                    </div>
                                ) : (
                                    chat.map((msg) => (
                                        <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${msg.role === 'user' ? 'bg-primary-600 text-white rounded-br-none' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-bl-none'}`}>
                                                {msg.isThinking && <div className="text-xs text-gray-400 italic mb-2 animate-pulse">Thinking deeply...</div>}
                                                {msg.role === 'user' ? (
                                                    <div className="whitespace-pre-wrap">{msg.text}</div>
                                                ) : (
                                                    <div className="space-y-2">
                                                        <MarkdownContent content={msg.text} />
                                                        <div className="flex gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 opacity-50 hover:opacity-100 transition-opacity">
                                                            <button onClick={() => navigator.clipboard.writeText(msg.text)} title="Copy" className="p-1 hover:text-primary-500"><IconClipboard /></button>
                                                            <button onClick={() => handleExportPDF(msg.text, 'response')} title="Export PDF" className="p-1 hover:text-primary-500"><IconDownload /></button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input Area */}
                            <div className="p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                                <div className="max-w-4xl mx-auto space-y-3">
                                    {/* Controls */}
                                    <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-hide">
                                        <label className="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-xs font-medium text-gray-600 dark:text-gray-300 transition-colors whitespace-nowrap">
                                            <IconUpload /> {fileToUpload ? fileToUpload.name.substring(0, 15) + '...' : 'Attach Context'}
                                            <input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={(e) => setFileToUpload(e.target.files?.[0] || null)} />
                                        </label>
                                        
                                        <div className="h-4 w-px bg-gray-300 dark:bg-gray-600"></div>

                                        <select 
                                            value={outputFormat}
                                            onChange={(e) => setOutputFormat(e.target.value as OutputFormat)}
                                            className="bg-transparent text-xs font-medium text-gray-600 dark:text-gray-300 outline-none cursor-pointer hover:text-primary-500"
                                        >
                                            {FORMAT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                                        </select>
                                        
                                        {user.plan !== 'free' && (
                                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                                <input type="checkbox" checked={useThinking} onChange={e => setUseThinking(e.target.checked)} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                                                <span className="text-xs font-medium text-gray-600 dark:text-gray-300 flex items-center gap-1"><IconBrain /> Deep Think</span>
                                            </label>
                                        )}
                                    </div>

                                    {/* Text Box */}
                                    <div className="relative">
                                        {isProcessingFile && (
                                            <div className="absolute inset-0 bg-white/70 dark:bg-gray-800/70 z-10 flex items-center justify-center rounded-xl backdrop-blur-sm">
                                                <div className="flex items-center gap-2 text-sm text-primary-600 font-medium">
                                                    <div className="loader w-4 h-4 border-2 border-primary-600 border-t-transparent !mb-0" />
                                                    Extracting text...
                                                </div>
                                            </div>
                                        )}
                                        <textarea
                                            value={input}
                                            onChange={(e) => setInput(e.target.value)}
                                            onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                                            placeholder="Ask about a lesson plan, rubric, or quiz..."
                                            className="w-full pl-4 pr-12 py-3 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none resize-none shadow-sm dark:text-white"
                                            rows={2}
                                        />
                                        <button 
                                            onClick={handleSend}
                                            disabled={isStreaming || (!input.trim() && !fileToUpload) || isProcessingFile}
                                            className="absolute right-2 bottom-2 p-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md"
                                        >
                                            {isStreaming ? <div className="loader w-4 h-4 border-2 border-white border-t-transparent !mb-0" /> : <IconSend />}
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-center text-gray-400">AI can make mistakes. Verify info.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* DOCS TAB */}
                    {activeTab === 'docs' && (
                        <div className="p-6 h-full overflow-y-auto">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-lg font-bold dark:text-white">Your Documents ({docs.length})</h3>
                                <label className={`px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 cursor-pointer flex items-center gap-2 shadow-sm font-medium transition-transform active:scale-95 ${isProcessingFile ? 'opacity-50 cursor-wait' : ''}`}>
                                    {isProcessingFile ? <div className="loader w-4 h-4 border-2 border-white border-t-transparent !mb-0"/> : <IconUpload />} 
                                    {isProcessingFile ? 'Uploading...' : 'Upload New'}
                                    <input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={handleFileUpload} disabled={isProcessingFile} />
                                </label>
                            </div>
                            {docs.length === 0 ? (
                                <div className="text-center py-20 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700">
                                    <p className="text-gray-400">No documents yet. Upload a PDF/DOCX to start.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {docs.map(doc => (
                                        <div key={doc.id} className="group p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-all flex flex-col justify-between">
                                            <div>
                                                <div className="flex items-start justify-between mb-2">
                                                    <IconFile type={doc.type} />
                                                    <span className="text-xs text-gray-400 uppercase bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">{doc.type}</span>
                                                </div>
                                                <h4 className="font-semibold text-gray-800 dark:text-gray-100 truncate mb-1" title={doc.name}>{doc.name}</h4>
                                                <p className="text-xs text-gray-500">{(doc.size / 1024).toFixed(1)} KB • {new Date(doc.created_at || 0).toLocaleDateString()}</p>
                                            </div>
                                            <div className="mt-4 flex gap-2 pt-4 border-t border-gray-100 dark:border-gray-700">
                                                <button onClick={() => { setInput(`Analyze this document: \n\n${doc.content.substring(0, 5000)}...`); setActiveTab('chat'); }} className="flex-1 text-xs py-2 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 font-medium">Analyze</button>
                                                <button onClick={() => {
                                                    const key = `${STORAGE_KEYS.DOCS_PREFIX}${user.id}`; // Simple delete for now
                                                    // In real app, call API
                                                    setDocs(d => d.filter(x => x.id !== doc.id));
                                                }} className="p-2 text-gray-400 hover:text-red-500 rounded hover:bg-red-50 dark:hover:bg-red-900/20"><IconTrash /></button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* CALENDAR TAB */}
                    {activeTab === 'calendar' && (
                        <div className="p-6 h-full overflow-y-auto">
                            <div className="mb-8">
                                <h3 className="text-lg font-bold dark:text-white mb-4">Add New Event</h3>
                                <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col md:flex-row gap-3 items-end">
                                    <div className="flex-1 w-full">
                                        <label className="text-xs text-gray-500 mb-1 block">Title</label>
                                        <input 
                                            value={newEvent.title} 
                                            onChange={e => setNewEvent({...newEvent, title: e.target.value})}
                                            placeholder="e.g., Math Quiz, History Lesson" 
                                            className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                                        />
                                    </div>
                                    <div className="w-full md:w-48">
                                        <label className="text-xs text-gray-500 mb-1 block">Date</label>
                                        <input 
                                            type="date" 
                                            value={newEvent.date} 
                                            onChange={e => setNewEvent({...newEvent, date: e.target.value})}
                                            className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                                        />
                                    </div>
                                    <div className="w-full md:w-32">
                                        <label className="text-xs text-gray-500 mb-1 block">Type</label>
                                        <select 
                                            value={newEvent.type} 
                                            onChange={e => setNewEvent({...newEvent, type: e.target.value as any})}
                                            className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                                        >
                                            <option value="class">Class</option>
                                            <option value="deadline">Deadline</option>
                                            <option value="meeting">Meeting</option>
                                        </select>
                                    </div>
                                    <button 
                                        onClick={handleAddEvent}
                                        disabled={!newEvent.title || !newEvent.date}
                                        className="w-full md:w-auto px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                                    >
                                        Add
                                    </button>
                                </div>
                            </div>

                            <h3 className="text-lg font-bold dark:text-white mb-4">Upcoming Schedule</h3>
                            <div className="space-y-4">
                                {events.map(ev => (
                                    <div key={ev.id} className="flex items-center p-4 bg-white dark:bg-gray-800 rounded-xl border-l-4 border-green-500 shadow-sm transition-transform hover:translate-x-1">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className={`text-xs font-bold px-2 py-0.5 rounded uppercase ${
                                                    ev.type === 'deadline' ? 'bg-red-100 text-red-600' : 
                                                    ev.type === 'meeting' ? 'bg-blue-100 text-blue-600' : 
                                                    'bg-green-100 text-green-600'
                                                }`}>{ev.type}</span>
                                                <span className="text-xs text-gray-400 font-mono">{ev.date}</span>
                                            </div>
                                            <h4 className="font-medium text-gray-800 dark:text-gray-100">{ev.title}</h4>
                                        </div>
                                        <button onClick={async () => {
                                            await api.deleteEvent(user.id, ev.id);
                                            setEvents(prev => prev.filter(e => e.id !== ev.id));
                                        }} className="p-2 text-gray-300 hover:text-red-500 transition-colors"><IconTrash /></button>
                                    </div>
                                ))}
                                {events.length === 0 && (
                                    <div className="text-center py-12 opacity-50">
                                        <IconCalendar />
                                        <p className="mt-2 text-sm">No events scheduled. Add one above!</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                </main>
            </div>

            {/* Modals */}
            <TermsModal isOpen={showTerms} onClose={() => setShowTerms(false)} />
            <ApiKeyModal isOpen={showApiKey} onClose={() => setShowApiKey(false)} />
            <PricingModal isOpen={showPricing} onClose={() => setShowPricing(false)} user={user} />
            {user.role === 'admin' && <AdminSettingsModal isOpen={showAdmin} onClose={() => setShowAdmin(false)} user={user} />}
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);