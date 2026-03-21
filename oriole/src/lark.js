import * as lark from '@larksuiteoapi/node-sdk';

export function createLarkClient({ appId, appSecret }) {
  const client = new lark.Client({
    appId,
    appSecret,
  });

  return {
    async sendMessage(chatId, text) {
      const res = await client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });

      if (res.code !== 0) {
        throw new Error(`Lark sendMessage failed: ${res.code} ${res.msg}`);
      }

      return res.data;
    },

    async replyMessage(messageId, text) {
      const res = await client.im.v1.message.reply({
        path: { message_id: messageId },
        data: {
          msg_type: 'text',
          content: JSON.stringify({ text }),
          reply_in_thread: true,
        },
      });

      if (res.code !== 0) {
        throw new Error(`Lark replyMessage failed: ${res.code} ${res.msg}`);
      }

      return res.data;
    },

    async editMessage(messageId, text) {
      const res = await client.im.v1.message.update({
        path: { message_id: messageId },
        data: {
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });

      if (res.code !== 0) {
        throw new Error(`Lark editMessage failed: ${res.code} ${res.msg}`);
      }

      return res.data;
    },
  };
}
