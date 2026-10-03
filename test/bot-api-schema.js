// Bot API schema used by the strict Telegram mock (test/fake-bot-api.js).
// Transcribed from the official docs, https://core.telegram.org/bots/api — Bot API 10.3
// (August 24, 2026), fetched 2026-10-03. Each entry carries its doc anchor. Only the methods the
// server calls and the types it sends are listed; anything else the server sends fails the test.
//
// Type strings are copied from the docs' "Type" column. Constraints quote the docs' text.

const A = (anchor) => `https://core.telegram.org/bots/api#${anchor}`;

export const SOURCE = { url: "https://core.telegram.org/bots/api", version: "Bot API 10.3", date: "2026-08-24", fetched: "2026-10-03" };

// "Type of action to broadcast. Choose one ...: typing ..., upload_photo ..., record_video or upload_video ...,
// record_voice or upload_voice ..., upload_document ..., choose_sticker ..., find_location ...,
// record_video_note or upload_video_note ..."
export const CHAT_ACTIONS = [
  "typing", "upload_photo", "record_video", "upload_video", "record_voice", "upload_voice",
  "upload_document", "choose_sticker", "find_location", "record_video_note", "upload_video_note",
];

// Update fields (https://core.telegram.org/bots/api#update), i.e. the valid allowed_updates values.
export const UPDATE_TYPES = [
  "message", "edited_message", "channel_post", "edited_channel_post", "business_connection", "business_message",
  "edited_business_message", "deleted_business_messages", "guest_message", "message_reaction", "message_reaction_count",
  "inline_query", "chosen_inline_result", "callback_query", "shipping_query", "pre_checkout_query", "purchased_paid_media",
  "poll", "poll_answer", "my_chat_member", "chat_member", "chat_join_request", "chat_boost", "removed_chat_boost",
  "managed_bot", "subscription", "stopped_message_generation",
];

// "A two-letter ISO 639-1 language code. If empty, ..."
const LANGUAGE_CODE = { type: "String", pattern: /^([a-z]{2})?$/, rule: "A two-letter ISO 639-1 language code" };
const ALLOWED_UPDATES = { type: "Array of String", itemsEnum: UPDATE_TYPES, rule: "See Update for a complete list of available update types" };
const REPLY_MARKUP = { type: "InlineKeyboardMarkup or ReplyKeyboardMarkup or ReplyKeyboardRemove or ForceReply" };
// Common optional parameters of the send* methods (same rows in sendMessage/sendRichMessage/sendAudio).
const SEND_COMMON = {
  business_connection_id: { type: "String" },
  chat_id: { type: "Integer or String", required: true },
  message_thread_id: { type: "Integer" },
  direct_messages_topic_id: { type: "Integer" },
  ephemeral_message_parameters: { type: "EphemeralMessageParameters" },
  disable_notification: { type: "Boolean" },
  protect_content: { type: "Boolean" },
  allow_paid_broadcast: { type: "Boolean" },
  message_effect_id: { type: "String" },
  suggested_post_parameters: { type: "SuggestedPostParameters" },
  reply_parameters: { type: "ReplyParameters" },
  reply_markup: REPLY_MARKUP,
};

export const METHODS = {
  getMe: { doc: A("getme"), params: {}, returns: "User" },
  getUpdates: {
    doc: A("getupdates"),
    params: {
      offset: { type: "Integer" },
      limit: { type: "Integer", min: 1, max: 100, rule: "Values between 1-100 are accepted" },
      timeout: { type: "Integer", min: 0, rule: "Timeout in seconds for long polling ... Should be positive" },
      allowed_updates: ALLOWED_UPDATES,
    },
    returns: "Array of Update",
    note: "This method will not work if an outgoing webhook is set up.",
  },
  setWebhook: {
    doc: A("setwebhook"),
    params: {
      // Notes: "Ports currently supported for webhooks: 443, 80, 88, 8443."
      url: { type: "String", required: true, httpsOrEmpty: true, ports: [443, 80, 88, 8443], rule: "HTTPS URL to send updates to. Use an empty string to remove webhook integration." },
      certificate: { type: "InputFile" },
      ip_address: { type: "String" },
      max_connections: { type: "Integer", min: 1, max: 100, rule: "1-100. Defaults to 40" },
      allowed_updates: ALLOWED_UPDATES,
      drop_pending_updates: { type: "Boolean" },
      secret_token: { type: "String", pattern: /^[A-Za-z0-9_-]{1,256}$/, rule: "1-256 characters. Only characters A-Z, a-z, 0-9, _ and - are allowed." },
    },
    returns: "True",
  },
  deleteWebhook: { doc: A("deletewebhook"), params: { drop_pending_updates: { type: "Boolean" } }, returns: "True" },
  setMyCommands: {
    doc: A("setmycommands"),
    params: {
      commands: { type: "Array of BotCommand", required: true, maxItems: 100, rule: "At most 100 commands can be specified." },
      scope: { type: "BotCommandScope" },
      language_code: LANGUAGE_CODE,
    },
    returns: "True",
  },
  deleteMyCommands: {
    doc: A("deletemycommands"),
    params: { scope: { type: "BotCommandScope" }, language_code: LANGUAGE_CODE },
    returns: "True",
  },
  setMyDescription: {
    doc: A("setmydescription"),
    params: {
      description: { type: "String", maxLength: 512, rule: "New bot description; 0-512 characters." },
      language_code: LANGUAGE_CODE,
    },
    returns: "True",
  },
  setMyShortDescription: {
    doc: A("setmyshortdescription"),
    params: {
      short_description: { type: "String", maxLength: 120, rule: "New short description for the bot; 0-120 characters." },
      language_code: LANGUAGE_CODE,
    },
    returns: "True",
  },
  setChatMenuButton: {
    doc: A("setchatmenubutton"),
    params: { chat_id: { type: "Integer" }, menu_button: { type: "MenuButton" } },
    returns: "True",
  },
  sendMessage: {
    doc: A("sendmessage"),
    params: {
      ...SEND_COMMON,
      text: { type: "String", required: true, minLength: 1, maxLength: 4096, rule: "1-4096 characters after entities parsing" },
      parse_mode: { type: "String" },
      entities: { type: "Array of MessageEntity" },
      link_preview_options: { type: "LinkPreviewOptions" },
    },
    returns: "Message",
  },
  sendRichMessage: {
    doc: A("sendrichmessage"),
    params: { ...SEND_COMMON, rich_message: { type: "InputRichMessage", required: true } },
    returns: "Message",
  },
  sendAudio: {
    doc: A("sendaudio"),
    multipartFile: "audio",
    params: {
      ...SEND_COMMON,
      audio: { type: "InputFile or String", required: true, maxBytes: 50 * 1024 * 1024, extensions: [".mp3", ".m4a"], rule: "Your audio must be in the .MP3 or .M4A format ... up to 50 MB" },
      caption: { type: "String", maxLength: 1024, rule: "Audio caption, 0-1024 characters after entities parsing" },
      parse_mode: { type: "String" },
      caption_entities: { type: "Array of MessageEntity" },
      duration: { type: "Integer", min: 0, rule: "Duration of the audio in seconds" },
      performer: { type: "String" },
      title: { type: "String" },
      thumbnail: { type: "InputFile or String" },
    },
    returns: "Message",
  },
  sendChatAction: {
    doc: A("sendchataction"),
    params: {
      business_connection_id: { type: "String" },
      chat_id: { type: "Integer or String", required: true },
      message_thread_id: { type: "Integer" },
      action: { type: "String", required: true, enum: CHAT_ACTIONS },
    },
    returns: "True",
  },
  leaveChat: { doc: A("leavechat"), params: { chat_id: { type: "Integer or String", required: true } }, returns: "True" },
};

// Object types the server sends. Unions list their members; members not modeled here make the
// mock fail, so a new block or button kind must be transcribed before the server may send it.
export const TYPES = {
  BotCommand: {
    doc: A("botcommand"),
    fields: {
      command: { type: "String", required: true, pattern: /^[a-z0-9_]{1,32}$/, rule: "1-32 characters. Can contain only lowercase English letters, digits and underscores." },
      description: { type: "String", required: true, minLength: 1, maxLength: 256, rule: "1-256 characters" },
      is_ephemeral: { type: "Boolean" },
    },
  },
  BotCommandScope: {
    doc: A("botcommandscope"),
    union: [
      "BotCommandScopeDefault", "BotCommandScopeAllPrivateChats", "BotCommandScopeAllGroupChats",
      "BotCommandScopeAllChatAdministrators", "BotCommandScopeChat", "BotCommandScopeChatAdministrators", "BotCommandScopeChatMember",
    ],
  },
  BotCommandScopeDefault: { doc: A("botcommandscopedefault"), fields: { type: { type: "String", required: true, const: "default" } } },
  BotCommandScopeAllPrivateChats: { doc: A("botcommandscopeallprivatechats"), fields: { type: { type: "String", required: true, const: "all_private_chats" } } },
  BotCommandScopeAllGroupChats: { doc: A("botcommandscopeallgroupchats"), fields: { type: { type: "String", required: true, const: "all_group_chats" } } },
  BotCommandScopeAllChatAdministrators: { doc: A("botcommandscopeallchatadministrators"), fields: { type: { type: "String", required: true, const: "all_chat_administrators" } } },
  BotCommandScopeChat: { doc: A("botcommandscopechat"), fields: { type: { type: "String", required: true, const: "chat" }, chat_id: { type: "Integer or String", required: true } } },
  BotCommandScopeChatAdministrators: { doc: A("botcommandscopechatadministrators"), fields: { type: { type: "String", required: true, const: "chat_administrators" }, chat_id: { type: "Integer or String", required: true } } },
  BotCommandScopeChatMember: { doc: A("botcommandscopechatmember"), fields: { type: { type: "String", required: true, const: "chat_member" }, chat_id: { type: "Integer or String", required: true }, user_id: { type: "Integer", required: true } } },

  MenuButton: { doc: A("menubutton"), union: ["MenuButtonCommands", "MenuButtonWebApp", "MenuButtonDefault"] },
  MenuButtonCommands: { doc: A("menubuttoncommands"), fields: { type: { type: "String", required: true, const: "commands" } } },
  MenuButtonWebApp: {
    doc: A("menubuttonwebapp"),
    fields: { type: { type: "String", required: true, const: "web_app" }, text: { type: "String", required: true }, web_app: { type: "WebAppInfo", required: true } },
  },
  MenuButtonDefault: { doc: A("menubuttondefault"), fields: { type: { type: "String", required: true, const: "default" } } },
  WebAppInfo: { doc: A("webappinfo"), fields: { url: { type: "String", required: true, https: true, rule: "An HTTPS URL of a Web App" } } },

  LinkPreviewOptions: {
    doc: A("linkpreviewoptions"),
    fields: {
      is_disabled: { type: "Boolean" }, url: { type: "String" }, prefer_small_media: { type: "Boolean" },
      prefer_large_media: { type: "Boolean" }, show_above_text: { type: "Boolean" },
    },
  },
  InlineKeyboardMarkup: {
    doc: A("inlinekeyboardmarkup"),
    fields: { inline_keyboard: { type: "Array of Array of InlineKeyboardButton", required: true }, force_reply: { type: "Boolean" } },
  },
  InlineKeyboardButton: {
    doc: A("inlinekeyboardbutton"),
    // "Exactly one of the fields other than text, icon_custom_emoji_id, and style must be used"
    exactlyOneOf: ["url", "callback_data", "web_app", "login_url", "switch_inline_query", "switch_inline_query_current_chat", "switch_inline_query_chosen_chat", "copy_text", "callback_game", "pay", "disabled"],
    fields: {
      text: { type: "String", required: true },
      icon_custom_emoji_id: { type: "String" },
      style: { type: "String", enum: ["danger", "success", "primary"], rule: "Must be one of “danger” (red), “success” (green) or “primary” (blue)" },
      url: { type: "String", pattern: /^(https?|tg):\/\//i, rule: "HTTP or tg:// URL" },
      callback_data: { type: "String", minBytes: 1, maxBytes: 64, rule: "1-64 bytes" },
      web_app: { type: "WebAppInfo", privateChatOnly: true, rule: "Available only in private chats between a user and the bot" },
      login_url: { type: "LoginUrl" },
      switch_inline_query: { type: "String" },
      switch_inline_query_current_chat: { type: "String" },
      switch_inline_query_chosen_chat: { type: "SwitchInlineQueryChosenChat" },
      copy_text: { type: "CopyTextButton" },
      callback_game: { type: "CallbackGame" },
      pay: { type: "Boolean" },
      disabled: { type: "DisabledButton" },
    },
  },

  InputRichMessage: {
    doc: A("inputrichmessage"),
    // "Exactly one of the fields html, markdown, or blocks must be used."
    exactlyOneOf: ["html", "markdown", "blocks"],
    // https://core.telegram.org/bots/api#rich-message-limits
    richLimits: { maxChars: 32768, maxBlocks: 500, maxDepth: 16, doc: A("rich-message-limits") },
    fields: {
      blocks: { type: "Array of InputRichBlock" },
      html: { type: "String" },
      markdown: { type: "String" },
      media: { type: "Array of InputRichMessageMedia" },
      is_rtl: { type: "Boolean" },
      skip_entity_detection: { type: "Boolean" },
    },
  },
  InputRichBlock: {
    doc: A("inputrichblock"),
    discriminator: "type",
    union: [
      "InputRichBlockParagraph", "InputRichBlockSectionHeading", "InputRichBlockPreformatted", "InputRichBlockFooter",
      "InputRichBlockDivider", "InputRichBlockMathematicalExpression", "InputRichBlockAnchor", "InputRichBlockList",
      "InputRichBlockBlockQuotation", "InputRichBlockExpandableBlockQuotation", "InputRichBlockPullQuotation",
      "InputRichBlockCollage", "InputRichBlockSlideshow", "InputRichBlockTable", "InputRichBlockDetails", "InputRichBlockMap",
      "InputRichBlockButtons", "InputRichBlockAnimation", "InputRichBlockAudio", "InputRichBlockDocument", "InputRichBlockPhoto",
      "InputRichBlockVideo", "InputRichBlockVoiceNote", "InputRichBlockThinking",
    ],
  },
  InputRichBlockParagraph: {
    doc: A("inputrichblockparagraph"),
    fields: { type: { type: "String", required: true, const: "paragraph" }, text: { type: "RichText", required: true } },
  },
  InputRichBlockList: {
    doc: A("inputrichblocklist"),
    fields: { type: { type: "String", required: true, const: "list" }, items: { type: "Array of InputRichBlockListItem", required: true } },
  },
  InputRichBlockListItem: {
    doc: A("inputrichblocklistitem"),
    fields: {
      blocks: { type: "Array of InputRichBlock", required: true },
      has_checkbox: { type: "True" },
      is_checked: { type: "True" },
      value: { type: "Integer" },
      type: { type: "String", enum: ["a", "A", "i", "I", "1"] },
    },
  },
  InputRichBlockButtons: {
    doc: A("inputrichblockbuttons"),
    fields: {
      type: { type: "String", required: true, const: "buttons" },
      buttons: { type: "Array of RichMessageButton", required: true, minItems: 1, maxItems: 8, rule: "List of 1-8 buttons to send" },
      align: { type: "String", enum: ["left", "center", "right"] },
    },
  },
  RichMessageButton: {
    doc: A("richmessagebutton"),
    // "Exactly one of the fields other than text and style must be used to specify the type of the button."
    exactlyOneOf: ["url", "callback_data", "web_app", "login_url", "switch_inline_query", "switch_inline_query_current_chat", "switch_inline_query_chosen_chat", "copy_text", "disabled"],
    linkStyleOnlyFor: "callback_data", // "The style “link” is allowed only for callback buttons."
    fields: {
      text: { type: "RichText", required: true, plainOnly: true, rule: "May contain only plain text, RichTextCustomEmoji and RichTextDateTime entities." },
      style: { type: "String", enum: ["danger", "success", "primary", "link"] },
      url: { type: "String", pattern: /^(https?|tg):\/\//i, rule: "HTTP or tg:// URL" },
      callback_data: { type: "String", minBytes: 1, maxBytes: 64, rule: "1-64 bytes" },
      web_app: { type: "WebAppInfo", privateChatOnly: true, rule: "Available only in private chats between a user and the bot" },
      login_url: { type: "LoginUrl" },
      switch_inline_query: { type: "String" },
      switch_inline_query_current_chat: { type: "String" },
      switch_inline_query_chosen_chat: { type: "SwitchInlineQueryChosenChat" },
      copy_text: { type: "CopyTextButton" },
      disabled: { type: "DisabledButton" },
    },
  },
  // "Currently, it can be either a String for plain text, an Array of RichText, or any of the following types: ..."
  RichText: {
    doc: A("richtext"),
    richText: true,
    discriminator: "type",
    union: [
      "RichTextBold", "RichTextItalic", "RichTextUnderline", "RichTextStrikethrough", "RichTextSpoiler", "RichTextDateTime",
      "RichTextTextMention", "RichTextSubscript", "RichTextSuperscript", "RichTextMarked", "RichTextCode", "RichTextCustomEmoji",
      "RichTextMathematicalExpression", "RichTextUrl", "RichTextEmailAddress", "RichTextPhoneNumber", "RichTextBankCardNumber",
      "RichTextMention", "RichTextHashtag", "RichTextCashtag", "RichTextBotCommand", "RichTextButton", "RichTextAnchor",
      "RichTextAnchorLink", "RichTextReference", "RichTextReferenceLink",
    ],
  },
  RichTextBold: { doc: A("richtextbold"), fields: { type: { type: "String", required: true, const: "bold" }, text: { type: "RichText", required: true } } },
};

// Real Bot API response shapes the mock answers with (minimal, documented fields only).
export const RESULTS = {
  True: () => true,
  User: (bot) => ({ id: bot.id, is_bot: true, first_name: bot.first_name, username: bot.username, can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false }),
  Message: (bot, params) => ({ message_id: bot.nextMessageId++, date: Math.floor(Date.now() / 1000), chat: { id: Number(params.chat_id), type: "private" } }),
  "Array of Update": () => [],
};
