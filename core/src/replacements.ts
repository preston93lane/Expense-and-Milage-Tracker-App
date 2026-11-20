/**
 * Ideas for replacing paid subscriptions with something you own: a small
 * self-built app (like this tracker replaced QuickBooks), an AI agent
 * workflow, a free alternative — or a note that it's worth keeping.
 * Suggestions only; the call is yours.
 */
export type ReplacementApproach = 'already_replaced' | 'self_built_app' | 'agent_workflow' | 'free_alternative' | 'consolidate' | 'keep' | 'personal';

export interface ReplacementIdea {
  approach: ReplacementApproach;
  effort: 'none' | 'low' | 'medium' | 'high';
  idea: string;
}

const IDEAS: [RegExp, ReplacementIdea][] = [
  [/INTUIT|QUICKBOOKS|QBOOKS|FRESHBOOKS|XERO|WAVE ?APPS|EXPENSIFY|EVERLANCE|MILEIQ|TRIPLOG|HURDLR|KEEPER TAX/, {
    approach: 'already_replaced', effort: 'none',
    idea: 'This tracker now covers expenses, income, invoices, trips and tax reports (mileage is next). Cancel once you have exported your history.',
  }],
  [/TRACK1099|TAX1099|1099 ?ONLINE|TAXBANDITS/, {
    approach: 'already_replaced', effort: 'low',
    idea: 'The Contractors page exports a 1099-NEC list; the IRS IRIS portal files 1099s for free.',
  }],
  [/HONEYBOOK|DUBSADO|17HATS|BONSAI|INVOICE ?NINJA|PAYPAL INVOIC|SQUARE INVOIC/, {
    approach: 'self_built_app', effort: 'low',
    idea: 'Clients, invoices and retainers in this app cover the money side. Contracts/questionnaires could be a small add-on or an agent that fills templates.',
  }],
  [/CALENDLY|ACUITY|SAVVYCAL|YOUCANBOOK/, {
    approach: 'agent_workflow', effort: 'low',
    idea: 'Google Calendar “appointment schedules” are free, or an agent can propose times and book from your calendar.',
  }],
  [/MAILCHIMP|CONSTANT ?CONTACT|CONVERTKIT|KIT\.COM|FLODESK|MAILERLITE|KLAVIYO/, {
    approach: 'agent_workflow', effort: 'medium',
    idea: 'An agent can draft newsletters/outreach; send from a free tier or your email. Keep a paid plan only if your list is large.',
  }],
  [/HOOTSUITE|BUFFER|LATER\.COM|SPROUT|PLANOLY|LOOMLY|METRICOOL/, {
    approach: 'agent_workflow', effort: 'low',
    idea: 'Meta Business Suite and YouTube Studio schedule posts for free; an agent can write captions and keep a posting calendar.',
  }],
  [/GRAMMARLY|QUILLBOT|JASPER|COPY\.AI|WORDTUNE/, {
    approach: 'agent_workflow', effort: 'low',
    idea: 'Your Claude subscription already does editing and copywriting — likely redundant.',
  }],
  [/OTTER|FIREFLIES|DESCRIPT|REV\.COM|TRINT|SONIX/, {
    approach: 'agent_workflow', effort: 'medium',
    idea: 'Transcription + summaries can be an agent workflow; keep Descript if you rely on its video editing.',
  }],
  [/SQUARESPACE|WIX|WEEBLY|SHOWIT|PIXIESET|SMUGMUG|ZENFOLIO|FORMAT\.COM/, {
    approach: 'self_built_app', effort: 'medium',
    idea: 'A portfolio site can be built with Claude and hosted free (GitHub Pages / Cloudflare Pages). You still pay for the domain (~$12/yr). Keep if you use built-in client galleries/sales.',
  }],
  [/LINKTREE|BEACONS|LNK\.BIO/, { approach: 'self_built_app', effort: 'low', idea: 'A one-page links site is a quick self-built page.' }],
  [/NOTION|EVERNOTE|TODOIST|TICKTICK|ROAM|CRAFT DOCS/, {
    approach: 'free_alternative', effort: 'low',
    idea: 'You already use Obsidian — notes and tasks can live there for free.',
  }],
  [/ZAPIER|MAKE\.COM|INTEGROMAT|IFTTT/, {
    approach: 'agent_workflow', effort: 'medium',
    idea: 'Many automations can run as scheduled agent tasks or small scripts instead of a per-task plan.',
  }],
  [/ADOBE|CREATIVE CL/, {
    approach: 'free_alternative', effort: 'high',
    idea: 'Video: DaVinci Resolve is free and pro-grade. Photos: Affinity (one-time) or Darktable. Only worth it if you are not tied to Adobe workflows/clients.',
  }],
  [/CANVA/, { approach: 'keep', effort: 'none', idea: 'Hard to replace for quick social graphics; check the plan size.' }],
  [/DOCUSIGN|HELLOSIGN|DROPBOX SIGN|PANDADOC|ADOBE SIGN/, {
    approach: 'free_alternative', effort: 'low',
    idea: 'Free tiers or built-in PDF signing usually cover a few contracts a month.',
  }],
  [/DROPBOX|GOOGLE ONE|GOOGLE STORAGE|ICLOUD|ONEDRIVE|BACKBLAZE|BOX\.COM/, {
    approach: 'consolidate', effort: 'low',
    idea: 'Cloud storage: keep one main service. If you pay for two or more, consolidate.',
  }],
  [/OPENAI|CHATGPT|ANTHROPIC|CLAUDE|PERPLEXITY|GEMINI|MIDJOURNEY/, {
    approach: 'consolidate', effort: 'low',
    idea: 'AI tools are the engine for your agent workflows — keep the one you use most; drop overlapping ones.',
  }],
  [/ZOOM|LOOM|WEBEX|GOTOMEETING/, { approach: 'free_alternative', effort: 'low', idea: 'Google Meet (free) covers most calls; Loom can often be replaced by phone screen recording.' }],
  [/LASTPASS|1PASSWORD|DASHLANE|BITWARDEN|NORDPASS/, { approach: 'keep', effort: 'none', idea: 'Password manager: keep (security matters). Bitwarden has a solid free tier.' }],
  [/GODADDY|NAMECHEAP|SQUARESPACE DOMAINS|GOOGLE DOMAINS|CLOUDFLARE/, { approach: 'keep', effort: 'none', idea: 'Domain names: keep (move to a cheaper registrar if renewal prices jumped).' }],
  [/VERIZON|AT&T|T-MOBILE|XFINITY|SPECTRUM|COX|STARLINK/, { approach: 'keep', effort: 'none', idea: 'Phone/internet bill — deduct the business-use percentage with a split.' }],
  [/NETFLIX|HULU|DISNEY|SPOTIFY|APPLE TV|YOUTUBE PREMIUM|PEACOCK|PARAMOUNT|AUDIBLE|MAX\b|HBO/, { approach: 'personal', effort: 'none', idea: 'Personal entertainment — keep or cut based on use.' }],
  [/GYM|FITNESS|PLANET FITNESS|PELOTON|CLASSPASS/, { approach: 'personal', effort: 'none', idea: 'Personal — not deductible.' }],
];

export function replacementIdea(merchantKey: string): ReplacementIdea {
  const key = merchantKey.toUpperCase();
  for (const [re, idea] of IDEAS) if (re.test(key)) return idea;
  return {
    approach: 'agent_workflow',
    effort: 'medium',
    idea: 'Unknown — worth asking: what does this do for you, and could an agent workflow or a small self-built app do it?',
  };
}

export const APPROACH_LABEL: Record<ReplacementApproach, string> = {
  already_replaced: 'Replaced by this app',
  self_built_app: 'Self-built app',
  agent_workflow: 'Agent workflow',
  free_alternative: 'Free alternative',
  consolidate: 'Consolidate',
  keep: 'Keep',
  personal: 'Personal',
};
