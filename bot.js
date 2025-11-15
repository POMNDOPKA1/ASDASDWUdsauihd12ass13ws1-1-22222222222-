

import {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events
} from "discord.js";
import dotenv from "dotenv";
dotenv.config();

// ---------------- CONFIG ----------------
const TOKEN = process.env.DISCORD_TOKEN;
const APPLICATIONS_CHANNEL_ID = process.env.APPLICATIONS_CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

const MODERATOR_ROLES = process.env.MODERATOR_ROLES.split(",");
const MEMBER_ROLE_NAME = process.env.MEMBER_ROLE_NAME;
const CONTENT_MAKER_ROLE_NAME = process.env.CONTENT_MAKER_ROLE_NAME;

// Хранилище заявок
const applications = new Map();

// КЛИЕНТ -------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// VALIDATION ---------------
const validateAge = age => {
  const n = Number(age);
  return Number.isInteger(n) && n >= 8 && n <= 99;
};

const validateMinecraftNick = nick => /^[A-Za-z0-9_]{3,16}$/.test(nick);
const validateTelegram = tg => (!tg ? true : /^@[A-Za-z0-9_]{3,}$/.test(tg));

const userIsModerator = member =>
  member.roles.cache.some(r => MODERATOR_ROLES.includes(r.name));

// ----------------- CREATE APPLICATION THREAD ----------------
async function createApplicationThread(member) {
  const channel = await client.channels.fetch(APPLICATIONS_CHANNEL_ID);
  if (!channel) return;

  const num = Math.floor(Math.random() * 99999);

  const thread = await channel.threads.create({
    name: `Заявка-${num}`,
    autoArchiveDuration: 1440
  });

  await thread.members.add(member.id);

  applications.set(thread.id, {
    applicantId: member.id,
    status: "Создана",
    data: null
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId("role_select")
    .setPlaceholder("Кем вы хотите стать?")
    .setMinValues(1)
    .setMaxValues(2)
    .addOptions([
      { label: "Участник", value: "member" },
      { label: "Контент мейкер", value: "content" },
      { label: "Сценарист", value: "writer" },
      { label: "Разработчик плагинов", value: "dev" },
      { label: "Модератор", value: "moderator" },
      { label: "ТехАдмин", value: "tech" },
      { label: "Другое", value: "other" }
    ]);

  const row = new ActionRowBuilder().addComponents(select);

  await thread.send({ content: `Пройдите заявку:`, components: [row] });

  try {
    await member.send(`Ваша заявка: ${thread.url}`);
  } catch {}

  return thread;
}

// SELECT -----------------------
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== "role_select") return;

  const selected = interaction.values;

  const modal = new ModalBuilder()
    .setCustomId("application_modal")
    .setTitle("Заявка");

  const mc = new TextInputBuilder()
    .setCustomId("mc")
    .setLabel("Ник в Minecraft")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  const age = new TextInputBuilder()
    .setCustomId("age")
    .setLabel("Возраст")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  const contact = new TextInputBuilder()
    .setCustomId("contact")
    .setLabel("Контакт (Telegram, опционально)")
    .setRequired(false)
    .setStyle(TextInputStyle.Short);

  const other = new TextInputBuilder()
    .setCustomId("other")
    .setLabel("Если выбрали 'Другое'")
    .setRequired(false)
    .setStyle(TextInputStyle.Paragraph);

  modal.addComponents(
    new ActionRowBuilder().addComponents(mc),
    new ActionRowBuilder().addComponents(age),
    new ActionRowBuilder().addComponents(contact),
    new ActionRowBuilder().addComponents(other)
  );

  interaction.client.applicationSelect = selected;
  interaction.client.applicationThread = interaction.channel;

  await interaction.showModal(modal);
});

// MODAL -------------------------
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (interaction.customId !== "application_modal") return;

  const thread = interaction.client.applicationThread;
  const selected = interaction.client.applicationSelect;

  const mc = interaction.fields.getTextInputValue("mc");
  const age = interaction.fields.getTextInputValue("age");
  const contact = interaction.fields.getTextInputValue("contact");
  const other = interaction.fields.getTextInputValue("other");

  if (!validateAge(age))
    return interaction.reply({ content: "Возраст 8-99.", ephemeral: true });
  if (!validateMinecraftNick(mc))
    return interaction.reply({ content: "Неверный ник.", ephemeral: true });
  if (!validateTelegram(contact))
    return interaction.reply({ content: "Неверный Telegram.", ephemeral: true });

  const app = applications.get(thread.id);
  app.data = { roles: selected, mc, age, contact, other };

  const btns = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("take_work")
      .setLabel("Взять")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("accept_app")
      .setLabel("Принять")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("reject_app")
      .setLabel("Отклонить")
      .setStyle(ButtonStyle.Danger)
  );

  await thread.send({
    content:
      `***Новая заявка***\nНик: **${mc}**\nВозраст: **${age}**\nКонтакт: **${
        contact || "-"
      }**\nВыбор: **${selected.join(", ")}**\nДругое: **${other || "-"}**`,
    components: [btns]
  });

  const log = await client.channels.fetch(LOG_CHANNEL_ID);
  if (log)
    log.send(
      `📥 Создана заявка в ${thread}\nНик: ${mc}\nВозраст: ${age}\nРоли: ${selected.join(
        ", "
      )}`
    );

  await interaction.reply({ content: "Отправлено!", ephemeral: true });
});

// BUTTONS ----------------------------
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

  const thread = interaction.channel;
  const app = applications.get(thread.id);
  if (!app) return;

  const member = interaction.member;
  if (!userIsModerator(member))
    return interaction.reply({ content: "Только модератор", ephemeral: true });

  const guild = interaction.guild;
  const applicant = await guild.members.fetch(app.applicantId);
  const log = await client.channels.fetch(LOG_CHANNEL_ID);

  if (interaction.customId === "take_work") {
    thread.setName(`${thread.name} [В работе]`).catch(() => {});
    thread.send(`🟦 Модератор ${member.user.username} взял в работу.`);
    if (log) log.send(`🟦 ${member} взял в работу ${thread}`);
    return interaction.reply({ content: "ОК", ephemeral: true });
  }

  if (interaction.customId === "accept_app") {
    thread.setName(`${thread.name} [Принята]`).catch(() => {});
    thread.send(`🟩 Одобрено модератором ${member.user.username}.`);

    if (Number(app.data.age) > 11) {
      if (app.data.roles.includes("member")) {
        const r = guild.roles.cache.find(r => r.name === MEMBER_ROLE_NAME);
        if (r) applicant.roles.add(r);
      }
      if (app.data.roles.includes("content")) {
        const r = guild.roles.cache.find(r => r.name === CONTENT_MAKER_ROLE_NAME);
        if (r) applicant.roles.add(r);
      }
    }

    if (log) log.send(`🟩 ${thread} принято`);
    return interaction.reply({ content: "ОК", ephemeral: true });
  }

  if (interaction.customId === "reject_app") {
    thread.setName(`${thread.name} [Отклонена]`).catch(() => {});
    thread.send(`🟥 Отклонено модератором ${member.user.username}.`);
    if (log) log.send(`🟥 ${thread} отклонена`);
    return interaction.reply({ content: "ОК", ephemeral: true });
  }
});

// NEW MEMBER -------------------------
client.on(Events.GuildMemberAdd, async member => {
  const thread = await createApplicationThread(member);
  if (thread) thread.send(`Пожалуйста, пройдите заявку.`);
});

// LOGIN ------------------------------
client.login(TOKEN);
