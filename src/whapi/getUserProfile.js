import axios from "axios";

const get = async (token) => {
    
    try {

        const res = await axios.get(`https://gate.whapi.cloud/users/profile`, 
            {
                headers: { 
                    accept: "application/json",
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            }
        );
        
        return res.data;

    } catch (err) {
        throw err;
    }
}

export default get;