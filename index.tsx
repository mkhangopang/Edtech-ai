import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// --- Types ---

type PlanType = 'free' | 'pro' | 'campus';

interface DocumentFile {
  id: string;
  userId: string; // Required for Firestore compatibility
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

interface ScheduleEvent {
  id: string;
  userId: string; // Required for Firestore compatibility
  title: string;
  date: string; // YYYY-MM-DD
  type: 'lesson' | 'assessment' | 'task' | 'meeting';
  description?: string;
  startTime?: string;
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
  DOCS_PREFIX: 'edtech_docs_v5_', // Suffix with userID
  EVENTS_PREFIX: 'edtech_events_v5_' // Suffix with userID
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

const IconStar = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
  </svg>
);

const IconCalendar = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const IconChevronLeft = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
);

const IconChevronRight = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
    </svg>
);

const IconPlus = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
    </svg>
);

const IconChat = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
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
  // Ensure pdfjsLib is available
  if (!window.pdfjsLib) {
      throw new Error("PDF Library not loaded. Please refresh the page.");
  }
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
  if (!window.mammoth) {
      throw new Error("DOCX Library not loaded. Please refresh the page.");
  }
  const result = await window.mammoth.extractRawText({ arrayBuffer: arrayBuffer });
  return result.value;
};

// Safe API Key retrieval (handles both node process and browser environments if bundled)
const getApiKey = (): string | undefined => {
    try {
        if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
            return process.env.API_KEY;
        }
        if ((import.meta as any).env?.VITE_API_KEY) {
            return (import.meta as any).env.VITE_API_KEY;
        }
        if (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_API_KEY) {
            return process.env.NEXT_PUBLIC_API_KEY;
        }
        if ((import.meta as any).env?.API_KEY) {
            return (import.meta as any).env.API_KEY;
        }
        return undefined;
    } catch (e) {
        return undefined;
    }
};

// --- Backend Integration Abstraction ---

/**
 * Calls the Secure AI Backend.
 * Currently bridges to Client SDK for prototype, but designed to be swapped 
 * for a Cloud Function call (fetch) without changing UI components.
 */
const callSecureAI = async (
    apiKey: string, 
    prompt: string, 
    systemInstruction: string,
    modelId: string = 'gemini-2.5-flash'
): Promise<string> => {
    // NOTE: For Production Migration to GCP
    // Replace this logic with:
    // const token = await auth.currentUser.getIdToken();
    // const res = await fetch('https://your-cloud-function-url/generate', {
    //   method: 'POST',
    //   headers: { 'Authorization': `Bearer ${token}` },
    //   body: JSON.stringify({ prompt, systemInstruction, modelId })
    // });
    // const data = await res.json();
    // return data.text;

    try {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
            model: modelId,
            contents: prompt,
            config: { systemInstruction }
        });
        return response.text || "No response generated.";
    } catch (error) {
        console.error("AI Error:", error);
        throw new Error("Failed to generate content. Please try again.");
    }
};

const handleExportPDF = (content: string, filename: string) => {
    if (!window.jspdf) {
        alert("PDF generator not loaded.");
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // Header
    doc.setFontSize(18);
    doc.setTextColor(79, 70, 229); // Primary color
    doc.text("Edtech AI Document", 20, 20);
    
    // Meta
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 20, 28);
    
    // Content
    doc.setFontSize(12);
    doc.setTextColor(0);
    
    const splitText = doc.splitTextToSize(content, 170);
    let y = 40;
    
    for(let i = 0; i < splitText.length; i++) {
        if (y > 280) {
            doc.addPage();
            y = 20;
        }
        doc.text(splitText[i], 20, y);
        y += 7;
    }
    
    doc.save(`${filename}.pdf`);
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
  const index = users.findIndex(u => u.id === user.id || u.email.toLowerCase() === user.email.toLowerCase());
  if (index === -1) {
      users.push(user);
  } else {
      users[index] = user;
  }
  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
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

// --- Doc Storage Helpers ---

const getUserDocsKey = (userId: string) => `${STORAGE_KEYS.DOCS_PREFIX}${userId}`;
const getUserEventsKey = (userId: string) => `${STORAGE_KEYS.EVENTS_PREFIX}${userId}`;

const getStoredDocs = (userId: string): DocumentFile[] => {
    try {
        const docsStr = localStorage.getItem(getUserDocsKey(userId));
        return docsStr ? JSON.parse(docsStr) : [];
    } catch (e) {
        return [];
    }
};

const saveStoredDocs = (userId: string, docs: DocumentFile[]) => {
    localStorage.setItem(getUserDocsKey(userId), JSON.stringify(docs));
};

const getStoredEvents = (userId: string): ScheduleEvent[] => {
    try {
        const eventsStr = localStorage.getItem(getUserEventsKey(userId));
        return eventsStr ? JSON.parse(eventsStr) : [];
    } catch (e) {
        return [];
    }
};

const saveStoredEvents = (userId: string, events: ScheduleEvent[]) => {
    localStorage.setItem(getUserEventsKey(userId), JSON.stringify(events));
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

// --- Pricing Modal Component ---

const PricingModal = ({ isOpen, onClose, onUpgrade, currentPlan }: { isOpen: boolean, onClose: () => void, onUpgrade: (plan: PlanType) => void, currentPlan: PlanType }) => {
    if (!isOpen) return null;
    // ... same implementation as before ...
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
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-gray-500">
                        <IconClose />
                    </button>
                </div>
                
                <div className="p-6 md:p-8 overflow-y-auto bg-gray-50 dark:bg-gray-900">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {plans.map((plan) => (
                            <div 
                                key={plan.id} 
                                className={`relative rounded-xl p-6 border ${plan.id === 'pro' || plan.id === 'campus' ? 'border-transparent shadow-lg' : 'border-gray-200 dark:border-gray-700'} ${plan.color} flex flex-col`}
                            >
                                {plan.recommended && (
                                    <div className="absolute top-0 right-0 bg-yellow-400 text-yellow-900 text-xs font-bold px-2 py-1 rounded-bl-lg rounded-tr-lg">
                                        RECOMMENDED
                                    </div>
                                )}
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{plan.name}</h3>
                                <div className="text-3xl font-extrabold text-gray-900 dark:text-white mt-2 mb-4">{plan.price}</div>
                                <ul className="space-y-3 mb-8 flex-1">
                                    {plan.features.map((feat, i) => (
                                        <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                                            <IconCheck />
                                            <span>{feat}</span>
                                        </li>
                                    ))}
                                </ul>
                                <button
                                    onClick={() => onUpgrade(plan.id)}
                                    disabled={currentPlan === plan.id}
                                    className={`w-full py-2.5 rounded-lg text-white font-medium transition-all ${plan.btnColor} ${currentPlan === plan.id ? 'opacity-50 cursor-default' : 'shadow-md hover:shadow-lg'}`}
                                >
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

// --- Auth Component ---

const AuthScreen = ({ onLogin }: { onLogin: (user: User) => void }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [error, setError] = useState('');

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
           plan: 'campus',
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
      const user = users.find(u => u.email.toLowerCase() === cleanEmail && u.password === cleanPass);
      
      if (user) {
        setSession(user);
        onLogin(user);
      } else {
        setError('Invalid credentials. (Try admin@edtech.ai / admin)');
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
        plan: 'free',
        joinedDate: Date.now()
      };
      
      saveUser(newUser);
      setSession(newUser);
      setTimeout(() => {
          onLogin(newUser);
      }, 50);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4 font-sans relative">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl flex overflow-hidden border border-gray-200 dark:border-gray-700 min-h-[600px]">
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
        </div>

        <div className="w-full md:w-1/2 p-8 md:p-12 flex flex-col justify-center bg-white dark:bg-gray-800 relative">
          <div className="max-w-md mx-auto w-full">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              {isLogin ? 'Welcome Back' : 'Create Account'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-5 mt-8">
              {!isLogin && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full Name</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email Address</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white" />
              </div>

              {!isLogin && (
                <div>
                   <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Role</label>
                   <select value={role} onChange={(e) => setRole(e.target.value as any)} className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white">
                     <option value="user">User</option>
                     <option value="admin">Admin</option>
                   </select>
                </div>
              )}

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <button type="submit" className="w-full bg-primary-600 hover:bg-primary-700 text-white font-semibold py-3 rounded-lg transition-all shadow-lg">
                {isLogin ? 'Sign In' : 'Sign Up'}
              </button>
            </form>

            <div className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
              {isLogin ? "Don't have an account? " : "Already have an account? "}
              <button onClick={() => { setIsLogin(!isLogin); setError(''); }} className="text-primary-600 hover:text-primary-500 font-medium hover:underline">
                {isLogin ? 'Sign up' : 'Log in'}
              </button>
            </div>
            
             <div className="absolute bottom-4 right-4">
                 <button onClick={handleResetData} className="text-[10px] text-gray-300 hover:text-red-400 transition-colors flex items-center gap-1">
                    <IconTrash /> Reset Data
                 </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Modals ---

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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Assignment Title</label>
            <textarea 
              value={config.assignment}
              onChange={(e) => setConfig({...config, assignment: e.target.value})}
              placeholder="e.g. Persuasive Essay on Climate Change"
              className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white text-sm"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div>
               <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Grade Level</label>
               <select 
                 value={config.gradeLevel}
                 onChange={(e) => setConfig({...config, gradeLevel: e.target.value})}
                 className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white text-sm"
               >
                 <option>Elementary (K-5)</option>
                 <option>Middle School (6-8)</option>
                 <option>High School</option>
                 <option>University</option>
               </select>
             </div>
             <div>
               <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Scale</label>
               <select 
                 value={config.scale}
                 onChange={(e) => setConfig({...config, scale: e.target.value as any})}
                 className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white text-sm"
               >
                 <option value="3">3-Point</option>
                 <option value="4">4-Point</option>
                 <option value="5">5-Point</option>
               </select>
             </div>
          </div>
          
           {activeDocName && (
            <div className="flex items-center gap-2 pt-2">
               <input 
                 type="checkbox" 
                 id="useActiveDoc"
                 checked={config.useActiveDoc}
                 onChange={(e) => setConfig({...config, useActiveDoc: e.target.checked})}
                 className="w-4 h-4 text-primary-600 rounded"
               />
               <label htmlFor="useActiveDoc" className="text-sm text-gray-700 dark:text-gray-300">
                 Use active document: <span className="font-medium text-primary-600">{activeDocName}</span>
               </label>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex justify-end gap-3">
           <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 transition-colors">Cancel</button>
           <button onClick={() => onGenerate(config)} className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700">Generate Rubric</button>
        </div>
      </div>
    </div>
  );
};

const LessonPlanModal = ({ isOpen, onClose, onGenerate }: { isOpen: boolean, onClose: () => void, onGenerate: (config: LessonConfig) => void }) => {
    const [config, setConfig] = useState<LessonConfig>({
        templateId: '5e',
        topic: '',
        gradeLevel: '10th Grade',
        duration: '60 minutes',
        objectives: '',
        standards: '',
        useActiveDoc: false
    });

    if(!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700 flex flex-col">
                <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <IconClipboard /> Lesson Planner
                    </h2>
                    <button onClick={onClose}><IconClose /></button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Topic</label>
                        <input type="text" value={config.topic} onChange={e => setConfig({...config, topic: e.target.value})} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Template</label>
                            <select value={config.templateId} onChange={e => setConfig({...config, templateId: e.target.value})} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white">
                                {LESSON_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Duration</label>
                            <input type="text" value={config.duration} onChange={e => setConfig({...config, duration: e.target.value})} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white" />
                        </div>
                    </div>
                    <div>
                         <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Standards / Objectives</label>
                         <textarea value={config.objectives} onChange={e => setConfig({...config, objectives: e.target.value})} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white" rows={2} />
                    </div>
                </div>
                <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">Cancel</button>
                    <button onClick={() => onGenerate(config)} className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700">Generate Plan</button>
                </div>
            </div>
        </div>
    );
};

const AssessmentModal = ({ isOpen, onClose, onGenerate }: { isOpen: boolean, onClose: () => void, onGenerate: (config: AssessmentConfig) => void }) => {
    const [config, setConfig] = useState<AssessmentConfig>({
        type: 'mixed',
        topic: '',
        gradeLevel: '10th Grade',
        difficulty: 'medium',
        count: 10,
        includeKey: true,
        useActiveDoc: false
    });
    
    if(!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700 flex flex-col">
                <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <IconClipboardCheck /> Quiz Generator
                    </h2>
                    <button onClick={onClose}><IconClose /></button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Topic</label>
                        <input type="text" value={config.topic} onChange={e => setConfig({...config, topic: e.target.value})} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white" />
                    </div>
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
                            <select value={config.type} onChange={e => setConfig({...config, type: e.target.value as any})} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white">
                                <option value="mixed">Mixed</option>
                                <option value="mcq">Multiple Choice</option>
                                <option value="srq">Short Response</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Question Count</label>
                            <input type="number" value={config.count} onChange={e => setConfig({...config, count: parseInt(e.target.value)})} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 outline-none dark:text-white" />
                        </div>
                    </div>
                </div>
                <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">Cancel</button>
                    <button onClick={() => onGenerate(config)} className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700">Generate Quiz</button>
                </div>
            </div>
        </div>
    );
};

const AddEventModal = ({ isOpen, onClose, onAdd }: { isOpen: boolean, onClose: () => void, onAdd: (event: Omit<ScheduleEvent, 'id' | 'userId'>) => void }) => {
    const [title, setTitle] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [type, setType] = useState<ScheduleEvent['type']>('task');
    
    if(!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onAdd({ title, date, type });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm border border-gray-200 dark:border-gray-700 flex flex-col">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Add Event</h3>
                    <button onClick={onClose}><IconClose /></button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <input type="text" value={title} onChange={e => setTitle(e.target.value)} required placeholder="Event Title" className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border dark:border-gray-600 outline-none dark:text-white" />
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} required className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border dark:border-gray-600 outline-none dark:text-white" />
                    <select value={type} onChange={e => setType(e.target.value as any)} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border dark:border-gray-600 outline-none dark:text-white">
                        <option value="lesson">Lesson</option>
                        <option value="assessment">Assessment</option>
                        <option value="task">Task</option>
                        <option value="meeting">Meeting</option>
                    </select>
                    <button type="submit" className="w-full py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">Save</button>
                </form>
            </div>
        </div>
    );
};

const CalendarView = ({ events, onAddEvent, onDeleteEvent }: { events: ScheduleEvent[], onAddEvent: () => void, onDeleteEvent: (id: string) => void }) => {
    // Basic calendar implementation
    const today = new Date();
    const [month, setMonth] = useState(today.getMonth());
    const [year, setYear] = useState(today.getFullYear());
    
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    
    return (
        <div className="p-6 h-full flex flex-col">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold dark:text-white">{new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
                <div className="flex gap-2">
                     <button onClick={onAddEvent} className="px-3 py-1 bg-primary-600 text-white rounded-lg text-sm">+ Add</button>
                </div>
            </div>
            <div className="grid grid-cols-7 gap-1 flex-1">
                {['S','M','T','W','T','F','S'].map(d => <div key={d} className="text-center text-sm text-gray-500 font-bold">{d}</div>)}
                {Array.from({length: firstDay}).map((_, i) => <div key={`empty-${i}`} />)}
                {Array.from({length: daysInMonth}).map((_, i) => {
                    const day = i + 1;
                    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                    const dayEvents = events.filter(e => e.date === dateStr);
                    return (
                        <div key={day} className="border dark:border-gray-700 rounded-lg p-2 bg-white dark:bg-gray-800 relative group overflow-hidden">
                            <div className="text-sm font-bold dark:text-gray-300">{day}</div>
                            <div className="space-y-1 mt-1">
                                {dayEvents.map(e => (
                                    <div key={e.id} className="text-xs p-1 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200 truncate">
                                        {e.title}
                                    </div>
                                ))}
                            </div>
                            {dayEvents.length > 0 && <button onClick={() => onDeleteEvent(dayEvents[0].id)} className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-red-500"><IconClose /></button>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// --- Chat Interface ---

const ChatInterface = ({ 
    activeDoc, 
    messages, 
    isThinking, 
    onSendMessage,
    onClearChat
}: { 
    activeDoc: DocumentFile | null, 
    messages: Message[], 
    isThinking: boolean, 
    onSendMessage: (text: string, format?: OutputFormat) => void,
    onClearChat: () => void
}) => {
    const [input, setInput] = useState('');
    const endRef = useRef<HTMLDivElement>(null);
    const [showExportMenu, setShowExportMenu] = useState(false);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, isThinking]);

    const handleSend = () => {
        if (!input.trim()) return;
        onSendMessage(input);
        setInput('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const lastMsg = messages.filter(m => m.role === 'model').pop();

    return (
        <div className="flex flex-col h-full bg-white dark:bg-gray-900">
            {/* Header */}
            <div className="h-14 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 bg-white dark:bg-gray-900 z-10">
                 <div className="flex items-center gap-2">
                     <div className={`w-2 h-2 rounded-full ${activeDoc ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                     <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                         {activeDoc ? activeDoc.name : 'General Context'}
                     </span>
                 </div>
                 <div className="flex items-center gap-2">
                     <div className="relative">
                        <button 
                          onClick={() => setShowExportMenu(!showExportMenu)}
                          className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                          title="Export Chat"
                        >
                            <IconDownload />
                        </button>
                        {showExportMenu && lastMsg && (
                            <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-20 py-1">
                                <button 
                                    onClick={() => { handleExportPDF(lastMsg.text, "Edtech_AI_Export"); setShowExportMenu(false); }}
                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                                >
                                    Download PDF
                                </button>
                            </div>
                        )}
                     </div>
                     <button onClick={onClearChat} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors" title="Clear Chat">
                         <IconTrash />
                     </button>
                 </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 opacity-50">
                        <IconBot />
                        <p className="mt-2 text-sm">Select a document or start typing to begin.</p>
                    </div>
                )}
                
                {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div 
                            className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${
                                msg.role === 'user' 
                                ? 'bg-primary-600 text-white rounded-br-none' 
                                : 'bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-bl-none'
                            }`}
                        >
                            {msg.role === 'model' ? (
                                <MarkdownContent content={msg.text} />
                            ) : (
                                <p className="whitespace-pre-wrap">{msg.text}</p>
                            )}
                        </div>
                    </div>
                ))}
                
                {isThinking && (
                    <div className="flex justify-start">
                        <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-bl-none p-4 shadow-sm flex items-center gap-2">
                            <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce"></div>
                            <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce delay-75"></div>
                            <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce delay-150"></div>
                        </div>
                    </div>
                )}
                <div ref={endRef} />
            </div>

            {/* Input */}
            <div className="p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
                <div className="relative">
                    <textarea 
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask Edtech AI..."
                        className="w-full pl-4 pr-12 py-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none resize-none shadow-sm dark:text-white"
                        rows={1}
                        style={{ minHeight: '50px', maxHeight: '150px' }}
                    />
                    <button 
                        onClick={handleSend}
                        disabled={!input.trim() || isThinking}
                        className="absolute right-2 bottom-2 p-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                        <IconSend />
                    </button>
                </div>
                <div className="flex gap-2 mt-2 overflow-x-auto scrollbar-hide">
                    {FORMAT_OPTIONS.map(fmt => (
                        <button 
                            key={fmt.id}
                            onClick={() => onSendMessage(input || "Generate this.", fmt.id)}
                            className="text-xs px-3 py-1 rounded-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors whitespace-nowrap"
                        >
                            {fmt.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

// --- App Component ---

const App = () => {
    const [user, setUser] = useState<User | null>(null);
    const [view, setView] = useState<'chat' | 'calendar' | 'dashboard'>('dashboard');
    const [docs, setDocs] = useState<DocumentFile[]>([]);
    const [activeDocId, setActiveDocId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [events, setEvents] = useState<ScheduleEvent[]>([]);
    const [isThinking, setIsThinking] = useState(false);
    
    // Modals
    const [isPricingOpen, setIsPricingOpen] = useState(false);
    const [isRubricOpen, setIsRubricOpen] = useState(false);
    const [isLessonOpen, setIsLessonOpen] = useState(false);
    const [isAssessmentOpen, setIsAssessmentOpen] = useState(false);
    const [isEventOpen, setIsEventOpen] = useState(false);

    useEffect(() => {
        const session = getSession();
        if (session) {
            setUser(session);
            setDocs(getStoredDocs(session.id));
            setEvents(getStoredEvents(session.id));
        }
    }, []);

    const handleLogin = (u: User) => {
        setUser(u);
        setDocs(getStoredDocs(u.id));
        setEvents(getStoredEvents(u.id));
        setView('dashboard');
    };

    const handleLogout = () => {
        clearSession();
        setUser(null);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || !e.target.files[0] || !user) return;
        const file = e.target.files[0];
        
        // Plan limit check
        const plan = PLAN_LIMITS[user.plan];
        if (docs.length >= plan.maxDocs) {
            alert(`Upgrade to upload more documents! Limit: ${plan.maxDocs}`);
            setIsPricingOpen(true);
            return;
        }

        try {
            let content = "";
            let type: DocumentFile['type'] = 'txt';
            
            if (file.type === 'application/pdf') {
                type = 'pdf';
                content = await extractTextFromPDF(file);
            } else if (file.type.includes('document') || file.name.endsWith('.docx')) {
                type = 'docx';
                content = await extractTextFromDOCX(file);
            } else {
                content = await file.text();
            }

            const newDoc: DocumentFile = {
                id: crypto.randomUUID(),
                userId: user.id, // Securely link doc to user
                name: file.name,
                type,
                content,
                size: file.size,
                uploadDate: Date.now()
            };

            const updatedDocs = [...docs, newDoc];
            setDocs(updatedDocs);
            saveStoredDocs(user.id, updatedDocs);
            setActiveDocId(newDoc.id);
            setView('chat');
            incrementStat('docs');
        } catch (err) {
            console.error(err);
            alert("Failed to parse file.");
        }
    };

    const handleSendMessage = async (text: string, formatId: OutputFormat = 'auto') => {
        if (!user) return;
        
        const apiKey = getApiKey();
        if (!apiKey) {
            alert("API Key missing.");
            return;
        }

        const newUserMsg: Message = {
            id: crypto.randomUUID(),
            role: 'user',
            text,
            timestamp: Date.now()
        };
        
        setMessages(prev => [...prev, newUserMsg]);
        setIsThinking(true);
        incrementStat('queries');

        // Construct Prompt
        const activeDoc = docs.find(d => d.id === activeDocId);
        let finalPrompt = text;
        let systemInstruction = DEFAULT_MASTER_PROMPT;
        
        if (activeDoc) {
            finalPrompt = `CONTEXT DOCUMENT:\n${activeDoc.content.substring(0, 30000)}\n\nUSER QUERY:\n${text}`;
        }
        
        if (formatId !== 'auto') {
            const fmt = FORMAT_OPTIONS.find(f => f.id === formatId);
            if (fmt) systemInstruction += `\n\nOUTPUT FORMAT REQUIRED: ${fmt.instruction}`;
        }

        try {
            const responseText = await callSecureAI(apiKey, finalPrompt, systemInstruction);
            
            const aiMsg: Message = {
                id: crypto.randomUUID(),
                role: 'model',
                text: responseText,
                timestamp: Date.now()
            };
            setMessages(prev => [...prev, aiMsg]);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: crypto.randomUUID(),
                role: 'model',
                text: "I encountered an error connecting to the AI service. Please try again.",
                timestamp: Date.now(),
                isError: true
            }]);
        } finally {
            setIsThinking(false);
        }
    };

    const handleUpgrade = (plan: PlanType) => {
        if (!user) return;
        const updatedUser = { ...user, plan };
        setUser(updatedUser);
        saveUser(updatedUser);
        setSession(updatedUser);
        setIsPricingOpen(false);
    };

    const handleAddEvent = (eventData: Omit<ScheduleEvent, 'id' | 'userId'>) => {
        if (!user) return;
        const newEvent: ScheduleEvent = {
            ...eventData,
            id: crypto.randomUUID(),
            userId: user.id
        };
        const updated = [...events, newEvent];
        setEvents(updated);
        saveStoredEvents(user.id, updated);
    };

    if (!user) return <AuthScreen onLogin={handleLogin} />;

    const activeDoc = docs.find(d => d.id === activeDocId) || null;

    return (
        <div className="flex h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans overflow-hidden">
            {/* Sidebar */}
            <div className="w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col z-20 shadow-xl">
                <div className="p-5 flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center text-white font-bold">E</div>
                    <span className="font-bold text-lg tracking-tight">Edtech AI</span>
                    <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-xs rounded text-gray-500 font-medium uppercase">{user.plan}</span>
                </div>

                <div className="px-3 py-2 space-y-1">
                    <button onClick={() => setView('dashboard')} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === 'dashboard' ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                        <IconMenu /> Dashboard
                    </button>
                    <button onClick={() => setView('chat')} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === 'chat' ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                        <IconChat /> Chat Assistant
                    </button>
                    <button onClick={() => setView('calendar')} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === 'calendar' ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                        <IconCalendar /> Calendar
                    </button>
                </div>

                <div className="px-4 py-4">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Documents</h3>
                    <div className="space-y-1 mb-3 max-h-40 overflow-y-auto scrollbar-hide">
                        {docs.map(doc => (
                            <button 
                                key={doc.id}
                                onClick={() => { setActiveDocId(doc.id); setView('chat'); }}
                                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm truncate ${activeDocId === doc.id ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                            >
                                <IconFile type={doc.type} />
                                <span className="truncate">{doc.name}</span>
                            </button>
                        ))}
                    </div>
                    <label className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 cursor-pointer px-2">
                        <IconUpload /> Upload New
                        <input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={handleFileUpload} />
                    </label>
                </div>

                <div className="mt-auto p-4 border-t border-gray-200 dark:border-gray-800">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                            {user.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate dark:text-white">{user.name}</div>
                            <div className="text-xs text-gray-500 truncate">{user.email}</div>
                        </div>
                        <button onClick={handleLogout} className="text-gray-400 hover:text-gray-600"><IconLogout /></button>
                    </div>
                    {user.plan === 'free' && (
                         <button onClick={() => setIsPricingOpen(true)} className="w-full py-2 bg-gradient-to-r from-primary-600 to-indigo-600 text-white text-xs font-bold rounded-lg shadow-lg hover:shadow-primary-500/25 transition-all">
                             UPGRADE TO PRO
                         </button>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0 bg-gray-50 dark:bg-gray-900 relative">
                 {view === 'dashboard' && (
                     <div className="p-8 overflow-y-auto h-full">
                         <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">Welcome, {user.name}</h1>
                         <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                             <button onClick={() => setIsLessonOpen(true)} className="p-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all text-left">
                                 <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center text-blue-600 mb-4"><IconClipboard /></div>
                                 <h3 className="font-bold text-lg mb-1 dark:text-white">Lesson Planner</h3>
                                 <p className="text-sm text-gray-500 dark:text-gray-400">Generate structured 5E or UbD plans.</p>
                             </button>
                             <button onClick={() => setIsAssessmentOpen(true)} className="p-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all text-left">
                                 <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center text-green-600 mb-4"><IconClipboardCheck /></div>
                                 <h3 className="font-bold text-lg mb-1 dark:text-white">Quiz Maker</h3>
                                 <p className="text-sm text-gray-500 dark:text-gray-400">Create tests with answer keys instantly.</p>
                             </button>
                             <button onClick={() => setIsRubricOpen(true)} className="p-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all text-left">
                                 <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center text-purple-600 mb-4"><IconTable /></div>
                                 <h3 className="font-bold text-lg mb-1 dark:text-white">Rubric Generator</h3>
                                 <p className="text-sm text-gray-500 dark:text-gray-400">Build grading criteria based on standards.</p>
                             </button>
                         </div>
                         
                         <div className="bg-gradient-to-r from-primary-900 to-indigo-900 rounded-2xl p-8 text-white relative overflow-hidden">
                             <div className="relative z-10">
                                 <h2 className="text-2xl font-bold mb-2">Ready to save hours of work?</h2>
                                 <p className="text-indigo-200 mb-4 max-w-lg">Upload a textbook PDF or paste your curriculum standards to get context-aware AI assistance.</p>
                                 <button onClick={() => setView('chat')} className="px-6 py-2 bg-white text-primary-900 font-bold rounded-lg hover:bg-gray-100 transition-colors">Start Chatting</button>
                             </div>
                             <div className="absolute right-0 bottom-0 opacity-10">
                                 <svg width="200" height="200" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zm0 9l2.5-1.25L12 8.5l-2.5 1.25L12 11zm0 2.5l-5-2.5-5 2.5L12 22l10-8.5-5-2.5-5 2.5z"/></svg>
                             </div>
                         </div>
                     </div>
                 )}

                 {view === 'chat' && (
                     <ChatInterface 
                         activeDoc={activeDoc} 
                         messages={messages} 
                         isThinking={isThinking} 
                         onSendMessage={handleSendMessage}
                         onClearChat={() => setMessages([])}
                     />
                 )}
                 
                 {view === 'calendar' && (
                     <CalendarView 
                        events={events} 
                        onAddEvent={() => setIsEventOpen(true)}
                        onDeleteEvent={(id) => {
                            const updated = events.filter(e => e.id !== id);
                            setEvents(updated);
                            if(user) saveStoredEvents(user.id, updated);
                        }}
                     />
                 )}
            </div>

            {/* Modals */}
            <PricingModal isOpen={isPricingOpen} onClose={() => setIsPricingOpen(false)} onUpgrade={handleUpgrade} currentPlan={user.plan} />
            <RubricGeneratorModal isOpen={isRubricOpen} onClose={() => setIsRubricOpen(false)} onGenerate={(c) => { setIsRubricOpen(false); handleSendMessage(`Generate a rubric for ${c.assignment} for ${c.gradeLevel} using a ${c.scale}-point scale. Focus on Bloom's level: ${c.bloomsLevel}. ${c.objectives ? 'Objectives: ' + c.objectives : ''}`, 'table'); }} activeDocName={activeDoc?.name || null} />
            <LessonPlanModal isOpen={isLessonOpen} onClose={() => setIsLessonOpen(false)} onGenerate={(c) => { setIsLessonOpen(false); handleSendMessage(`Create a ${c.duration} lesson plan on "${c.topic}" for ${c.gradeLevel} using the ${c.templateId} format. Standards: ${c.standards}. Objectives: ${c.objectives}`, 'report'); }} />
            <AssessmentModal isOpen={isAssessmentOpen} onClose={() => setIsAssessmentOpen(false)} onGenerate={(c) => { setIsAssessmentOpen(false); handleSendMessage(`Create a ${c.count}-question ${c.difficulty} difficulty ${c.type} quiz on "${c.topic}" for ${c.gradeLevel}. ${c.includeKey ? 'Include an answer key.' : ''}`, 'auto'); }} />
            <AddEventModal isOpen={isEventOpen} onClose={() => setIsEventOpen(false)} onAdd={handleAddEvent} />
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
