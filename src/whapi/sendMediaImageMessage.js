import axios from "axios";
import fs from "fs/promises";
import mime from "mime-types";

const post = async (token, groupId, pathImage, caption) => {
    
    try {

        const buffer = await fs.readFile(pathImage);
        const mimeType = mime.lookup(pathImage) || "image/jpeg";
        const base64Image = `data:${mimeType};base64,${buffer.toString("base64")}`;

        const body = {
            to: groupId,
            media: base64Image,
            caption
        };

        const res = await axios.post(`https://gate.whapi.cloud/messages/image`, 
            body,
            {
                headers: { 
                    accept: "application/json",
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            }
        );

        const { success, msg } = res.data;
        const { sent, message } = success ? msg : {sent: false, message: null};
        const { id } = sent ? message : { id: null};

        return {success, sent, id};

    } catch (err) {
        throw err;
    }
}

export default post;