export type Room = {
  id: string;
  created_by: string;
  partner_name: string;
  invite_token: string;
  created_at: string;
};

export type Member = {
  room_id: string;
  user_id: string;
  display_name: string;
  my_lang: string;
  target_lang: string;
  joined_at: string;
};

export type Message = {
  id: string;
  room_id: string;
  sender_id: string;
  kind: "text" | "audio";
  original_text: string;
  source_lang: string;
  audio_path: string | null;
  translations: Record<string, string>;
  status: "processing" | "ready" | "error";
  error: string | null;
  created_at: string;
};
