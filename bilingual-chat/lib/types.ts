export type Room = {
  id: string;
  hotel_id?: string | null;
  room_label?: string | null;
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

/** Membre d'une conversation, ou réceptionniste de l'hôtel ("staff"). */
export type Participant = Member & { role: "member" | "staff" };

export type HotelContext = {
  hotel_id: string;
  hotel_name: string;
  room_label: string | null;
  is_staff: boolean;
};

export type Message = {
  id: string;
  room_id: string;
  sender_id: string;
  kind: "text" | "audio";
  original_text: string;
  source_lang: string;
  /** Langue réellement détectée dans le message (null pour les anciens messages) */
  detected_lang: string | null;
  audio_path: string | null;
  translations: Record<string, string>;
  status: "processing" | "ready" | "error";
  error: string | null;
  created_at: string;
};
