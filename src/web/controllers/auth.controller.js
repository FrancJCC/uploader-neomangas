const User = require('../../models/User');
const bcrypt = require('bcryptjs');

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log(`[AUTH] Intento de login: ${email}`);

        // 1. Find User
        const user = await User.findOne({ email: { $regex: new RegExp(`^${email.trim()}$`, 'i') } });
        
        if (!user) {
            console.log(`[AUTH] Usuario no encontrado (email exacto o trim): ${email}`);
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // 2. Check Password
        if (!user.passwordHash) {
             console.log(`[AUTH] Usuario sin contraseña: ${email}`);
             return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        
        if (!isMatch) {
            console.log(`[AUTH] Contraseña incorrecta para: ${email}`);
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        console.log(`[AUTH] Login exitoso: ${user.username}`);
        res.json({ 
            success: true, 
            username: user.username,
            roles: user.roles 
        });

    } catch (error) {
        console.error('[AUTH] Error:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};
